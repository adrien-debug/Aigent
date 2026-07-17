import { describe, it, expect } from 'vitest'
import {
  makeShadowInput,
  runShadowExperiment,
  replayShadow,
  compareOnSameInput,
  type ShadowAgentRef,
  type ShadowInput,
  type ShadowRunOutput,
  type RunAgentFn,
} from '@/lib/agent-mission-control/market/shadow'
import { getScenario } from '@/lib/agent-mission-control/market/fixtures/scenarios'

// A frozen FIXTURE input built from a labeled scenario — never LIVE.
function fixtureInput(): ShadowInput<{ scenarioId: string; candleCount: number }> {
  const scenario = getScenario('trend-up')
  return makeShadowInput({
    inputId: 'fixture-trend-up',
    truth: scenario.truth as 'FIXTURE',
    asOf: scenario.asOf,
    payload: { scenarioId: scenario.id, candleCount: scenario.candles.length },
    label: scenario.description,
  })
}

const AGENTS: ShadowAgentRef[] = [
  { agentSlug: 'atlas', version: 'v1.0.0', model: 'gpt-5.4' },
  { agentSlug: 'vector', version: 'v1.0.0', model: 'gpt-5.4' },
]

// Deterministic injected executor — no OpenAI, no network. Echoes the input.
const runAgent: RunAgentFn<{ scenarioId: string; candleCount: number }> = (
  agent,
  input,
): ShadowRunOutput => ({
  output: { agentSlug: agent.agentSlug, lean: agent.agentSlug === 'atlas' ? 'bullish' : 'bearish', sawScenario: input.payload.scenarioId },
  toolsUsed: ['read_market_snapshot'],
  costUsd: 0.012,
  latencyMs: 340,
})

describe('shadow mode (Lot 7)', () => {
  it('produces records with evidenceLevel SNAPSHOT — never LIVE', async () => {
    const input = fixtureInput()
    const res = await runShadowExperiment({ input, agents: AGENTS, runAgent })

    expect(res.evidenceLevel).toBe('SNAPSHOT')
    expect(res.inputTruth).toBe('FIXTURE')
    expect(res.records).toHaveLength(2)
    for (const rec of res.records) {
      expect(rec.evidenceLevel).toBe('SNAPSHOT')
      // The proof level is a literal 'SNAPSHOT' type — LIVE is unreachable.
      expect(rec.evidenceLevel).not.toBe('LIVE')
      expect(rec.inputTruth).not.toBe('LIVE')
      expect(['SNAPSHOT', 'HISTORICAL', 'FIXTURE']).toContain(rec.inputTruth)
      // Full accounting recorded per run.
      expect(rec.toolsUsed).toEqual(['read_market_snapshot'])
      expect(rec.costUsd).toBeGreaterThan(0)
      expect(rec.latencyMs).toBeGreaterThan(0)
    }
  })

  it('refuses a LIVE-marked input at construction', () => {
    expect(() =>
      makeShadowInput({ inputId: 'x', truth: 'LIVE', asOf: 1, payload: null }),
    ).toThrow(/cannot be LIVE/)
  })

  it('replay of a record reproduces the exact frozen input', async () => {
    const input = fixtureInput()
    const res = await runShadowExperiment({ input, agents: AGENTS, runAgent })
    const replayed = replayShadow(res.records[0])

    expect(replayed).toEqual(input)
    expect(replayed.inputId).toBe('fixture-trend-up')
    expect(replayed.asOf).toBe(input.asOf)
    expect(replayed.truth).toBe('FIXTURE')
    // Re-running the same frozen input yields the same records (deterministic).
    const res2 = await runShadowExperiment({ input: replayed, agents: AGENTS, runAgent })
    expect(res2.records.map((r) => r.output)).toEqual(res.records.map((r) => r.output))
  })

  it('compareOnSameInput aligns agents on the SAME frozen input', async () => {
    const input = fixtureInput()
    const res = await runShadowExperiment({ input, agents: AGENTS, runAgent })
    const cmp = compareOnSameInput(res.records)

    expect(cmp.sameInput).toBe(true)
    expect(cmp.inputId).toBe('fixture-trend-up')
    expect(cmp.evidenceLevel).toBe('SNAPSHOT')
    expect(cmp.agents.map((a) => a.agentSlug)).toEqual(['atlas', 'vector'])
  })

  it('refuses to compare records that span different inputs', async () => {
    const a = fixtureInput()
    const b = makeShadowInput({ ...a, inputId: 'fixture-range', asOf: a.asOf + 1 })
    const resA = await runShadowExperiment({ input: a, agents: [AGENTS[0]], runAgent })
    const resB = await runShadowExperiment({ input: b, agents: [AGENTS[1]], runAgent })
    expect(() => compareOnSameInput([...resA.records, ...resB.records])).toThrow(
      /different inputs/,
    )
  })

  it('propagates unavailability instead of fabricating a result', async () => {
    const input = fixtureInput()
    const throwingRun: RunAgentFn<{ scenarioId: string; candleCount: number }> = (agent) => {
      if (agent.agentSlug === 'vector') throw new Error('provider outage')
      return { output: { ok: true }, toolsUsed: [], costUsd: 0, latencyMs: 10 }
    }
    const res = await runShadowExperiment({ input, agents: AGENTS, runAgent: throwingRun })
    expect(res.unavailableAgents).toEqual(['vector'])
    const vec = res.records.find((r) => r.agentSlug === 'vector')!
    expect(vec.unavailable?.reason).toMatch(/provider outage/)
    // Still stamped SNAPSHOT — never masquerading as a live success.
    expect(vec.evidenceLevel).toBe('SNAPSHOT')
  })

  it('exposes NO write / execution / order surface (read-only harness)', async () => {
    const shadowModule = await import('@/lib/agent-mission-control/market/shadow')
    const exportedNames = Object.keys(shadowModule)
    for (const forbidden of ['execute', 'order', 'submit', 'place', 'sendOrder', 'placeOrder']) {
      expect(exportedNames).not.toContain(forbidden)
    }

    // A produced record has no execution/order field.
    const res = await runShadowExperiment({ input: fixtureInput(), agents: [AGENTS[0]], runAgent })
    const rec = res.records[0] as unknown as Record<string, unknown>
    expect(rec).not.toHaveProperty('execute')
    expect(rec).not.toHaveProperty('order')
    expect(rec).not.toHaveProperty('submit')
    // Every export is either a value type or one of the three read-only fns.
    const callable = exportedNames.filter((n) => typeof (shadowModule as Record<string, unknown>)[n] === 'function')
    expect(callable.sort()).toEqual(
      ['compareOnSameInput', 'makeShadowInput', 'replayShadow', 'runShadowExperiment'].sort(),
    )
  })
})
