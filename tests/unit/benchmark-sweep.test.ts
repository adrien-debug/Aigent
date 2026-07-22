/**
 * benchmark-sweep — multi-model sweep over one benchmark suite.
 *
 * The runner is fully mocked through the injection seam: NO real benchmark is
 * executed here (a real leg would burn billed LLM calls).
 */
import { describe, expect, it } from 'vitest'

import {
  estimatePromptTokens,
  runBenchmarkSweep,
  type BenchmarkSweepDeps,
  type SweepModelSpec,
} from '@/lib/agent-mission-control/benchmark-sweep'
import type { BenchmarkRun } from '@/lib/agent-mission-control/types'

function fakeRun(model: string): BenchmarkRun {
  return {
    id: `run-${model}`,
    suiteId: 'suite-1',
    copilotId: 'cop-1',
    versionId: 'ver-1',
    model,
    modelProvider: 'local',
    runtime: 'custom',
    startedAt: '2026-07-20T00:00:00.000Z',
    finishedAt: '2026-07-20T00:01:00.000Z',
    status: 'completed',
    resultId: `res-${model}`,
  }
}

const L = (model: string): SweepModelSpec => ({ model, modelProvider: 'local' })

function deps(over: Partial<BenchmarkSweepDeps> = {}): BenchmarkSweepDeps {
  return {
    runSuite: async (a) => fakeRun(a.model ?? ''),
    isAvailable: () => true,
    contextTokensFor: () => 8192,
    scoreFor: async () => 50,
    ...over,
  }
}

const base = {
  copilotId: 'cop-1',
  suiteId: 'suite-1',
  runtime: 'custom' as const,
}

describe('runBenchmarkSweep', () => {
  it('runs every model sequentially, in order, one run each', async () => {
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0

    const res = await runBenchmarkSweep(
      { ...base, models: [L('local-qwen-7b'), L('local-qwen-32b'), L('local-reasoning-70b')] },
      deps({
        runSuite: async (a) => {
          inFlight += 1
          maxInFlight = Math.max(maxInFlight, inFlight)
          await new Promise((r) => setTimeout(r, 5))
          order.push(a.model ?? '')
          inFlight -= 1
          return fakeRun(a.model ?? '')
        },
      })
    )

    expect(order).toEqual(['local-qwen-7b', 'local-qwen-32b', 'local-reasoning-70b'])
    expect(maxInFlight).toBe(1)
    expect(res.ranCount).toBe(3)
    expect(res.legs.map((l) => l.status)).toEqual(['ran', 'ran', 'ran'])
  })

  it('never lets a leg fall back onto another model', async () => {
    const seen: Array<string | undefined> = []
    await runBenchmarkSweep(
      { ...base, models: [L('local-qwen-7b')] },
      deps({
        runSuite: async (a) => {
          seen.push(a.model)
          expect(a.allowFallback).toBe(false)
          return fakeRun(a.model ?? '')
        },
      })
    )
    expect(seen).toEqual(['local-qwen-7b'])
  })

  it('skips a model whose context window cannot hold the tasks — no 0 score', async () => {
    let called = 0
    const res = await runBenchmarkSweep(
      {
        ...base,
        models: [L('small'), L('big')],
        // ~10k chars => ~2500 tokens + 1024 reserved => ~3524 needed
        contextProbeTexts: ['x'.repeat(10_000)],
      },
      deps({
        contextTokensFor: (s) => (s.model === 'small' ? 2048 : 32768),
        runSuite: async (a) => {
          called += 1
          return fakeRun(a.model ?? '')
        },
      })
    )

    const [small, big] = res.legs
    expect(small.status).toBe('skipped')
    expect(small.status === 'skipped' && small.skipReason).toBe('context-window-too-small')
    expect(big.status).toBe('ran')
    // The undersized model was skipped BEFORE any call.
    expect(called).toBe(1)
    // And it carries no score at all — not a zero.
    expect(small).not.toHaveProperty('score')
  })

  it('skips an unavailable provider explicitly, without substituting', async () => {
    const res = await runBenchmarkSweep(
      { ...base, models: [L('local-qwen-7b'), L('local-reasoning-70b')] },
      deps({ isAvailable: (s) => s.model !== 'local-reasoning-70b' })
    )
    expect(res.legs[0].status).toBe('ran')
    const skipped = res.legs[1]
    expect(skipped.status).toBe('skipped')
    expect(skipped.status === 'skipped' && skipped.skipReason).toBe('provider-unavailable')
    expect(res.ranCount).toBe(1)
    expect(res.skippedCount).toBe(1)
  })

  it('aggregates: best score, counts, and agent-comparison flag', async () => {
    const scores: Record<string, number> = { a: 61.2, b: 88.4, c: 12 }
    const res = await runBenchmarkSweep(
      { ...base, models: [L('a'), L('b'), L('c'), L('d')] },
      deps({
        isAvailable: (s) => s.model !== 'd',
        scoreFor: async (r) => scores[r.model] ?? null,
      })
    )
    expect(res.best).toEqual({ model: 'b', modelProvider: 'local', score: 88.4 })
    expect(res.ranCount).toBe(3)
    expect(res.skippedCount).toBe(1)
    expect(res.failedCount).toBe(0)
    expect(res.comparesAgents).toBe(true)
  })

  it('a runner throw is a failed leg, not a bad score', async () => {
    const res = await runBenchmarkSweep(
      { ...base, models: [L('a')] },
      deps({
        runSuite: async () => {
          throw new Error('endpoint down')
        },
      })
    )
    expect(res.legs[0].status).toBe('failed')
    expect(res.failedCount).toBe(1)
    expect(res.best).toBeNull()
  })

  it('a run without a result yields score null, never 0, and cannot win best', async () => {
    const res = await runBenchmarkSweep(
      { ...base, models: [L('a'), L('b')] },
      deps({ scoreFor: async (r) => (r.model === 'a' ? null : 5) })
    )
    expect(res.legs[0].status === 'ran' && res.legs[0].score).toBeNull()
    expect(res.best?.model).toBe('b')
  })

  describe('langgraph truth reserve', () => {
    it('refuses to sweep a langgraph copilot by default', async () => {
      let called = 0
      const res = await runBenchmarkSweep(
        { ...base, runtime: 'langgraph', models: [L('a'), L('b')] },
        deps({
          runSuite: async (a) => {
            called += 1
            return fakeRun(a.model ?? '')
          },
        })
      )
      expect(called).toBe(0)
      expect(res.legs.every((l) => l.status === 'skipped')).toBe(true)
      expect(res.legs[0].status === 'skipped' && res.legs[0].skipReason).toBe('runtime-not-swept')
      expect(res.comparesAgents).toBe(false)
    })

    it('with explicit opt-in, legs are flagged judge-only and never claim agent comparison', async () => {
      const res = await runBenchmarkSweep(
        { ...base, runtime: 'langgraph', allowJudgeOnlySweep: true, models: [L('a'), L('b')] },
        deps()
      )
      expect(res.ranCount).toBe(2)
      expect(res.legs.every((l) => l.status === 'ran' && l.sweepScope === 'judge-only')).toBe(true)
      expect(res.comparesAgents).toBe(false)
    })
  })

  it('without a context probe, no model is skipped for context', async () => {
    const res = await runBenchmarkSweep(
      { ...base, models: [L('tiny')] },
      deps({ contextTokensFor: () => 512 })
    )
    expect(res.legs[0].status).toBe('ran')
  })
})

describe('estimatePromptTokens', () => {
  it('rounds up at ~4 chars per token', () => {
    expect(estimatePromptTokens(['abcd'])).toBe(1)
    expect(estimatePromptTokens(['abcde'])).toBe(2)
    expect(estimatePromptTokens(['abcd', 'abcd'])).toBe(2)
    expect(estimatePromptTokens([])).toBe(0)
  })
})
