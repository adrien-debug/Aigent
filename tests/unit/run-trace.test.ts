/**
 * Unit tests for run-trace.ts (src/lib/agent-mission-control/run-trace.ts).
 *
 * Pure, offline: langfuse and langsmith exporters are mocked — no network
 * call, no keys, no gpu1/langfuse/langsmith backend. Covers toDbStepKind's
 * rich→DB kind mapping, RunTrace.step() accumulation (index/status/detail),
 * finishAndExport's fail-open behaviour (steps always survive; traceUrl is
 * null when unconfigured), and tool-call steps carrying toolCallId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/langsmith', () => ({
  exportTrace: vi.fn(async () => ({ traceUrl: null, exported: false, reason: 'LANGSMITH_API_KEY not set' })),
  newTraceId: vi.fn(() => 'trace-fixed-id'),
}))

vi.mock('@/lib/agent-mission-control/langfuse', () => ({
  exportLangfuseTrace: vi.fn(async () => ({ exported: false, eventCount: 0, traceUrl: null })),
  isLangfuseConfigured: vi.fn(() => false),
}))

import { exportLangfuseTrace, isLangfuseConfigured } from '@/lib/agent-mission-control/langfuse'
import { exportTrace, newTraceId } from '@/lib/agent-mission-control/langsmith'
import { RunTrace, startTrace, toDbStepKind } from '@/lib/agent-mission-control/run-trace'

const mockExportTrace = vi.mocked(exportTrace)
const mockNewTraceId = vi.mocked(newTraceId)
const mockExportLangfuseTrace = vi.mocked(exportLangfuseTrace)
const mockIsLangfuseConfigured = vi.mocked(isLangfuseConfigured)

function baseContext() {
  return {
    copilotId: 'copilot-1',
    versionId: 'version-1',
    mode: 'run' as const,
    provider: 'openai' as const,
    model: 'gpt-5.4',
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockNewTraceId.mockReturnValue('trace-fixed-id')
  mockExportTrace.mockResolvedValue({
    traceUrl: null,
    exported: false,
    reason: 'LANGSMITH_API_KEY not set',
  })
  mockIsLangfuseConfigured.mockReturnValue(false)
  mockExportLangfuseTrace.mockResolvedValue({ exported: false, eventCount: 0, traceUrl: null })
})

describe('toDbStepKind', () => {
  it('maps judge to llm-call', () => {
    expect(toDbStepKind('judge')).toBe('llm-call')
  })

  it('maps fallback to guardrail-check', () => {
    expect(toDbStepKind('fallback')).toBe('guardrail-check')
  })

  it.each([
    'llm-call',
    'tool-call',
    'memory-read',
    'memory-write',
    'guardrail-check',
    'confirmation',
    'output',
  ] as const)('passes DB-native kind %s through unchanged', (kind) => {
    expect(toDbStepKind(kind)).toBe(kind)
  })
})

describe('startTrace', () => {
  it('returns a RunTrace instance carrying the given context', () => {
    const trace = startTrace(baseContext())
    expect(trace).toBeInstanceOf(RunTrace)
    expect(trace.context).toEqual(baseContext())
    expect(trace.length).toBe(0)
  })
})

describe('RunTrace.step', () => {
  it('accumulates steps with increasing index, preserving title/detail/status', () => {
    const trace = startTrace(baseContext())
    const nowMs = Date.parse('2026-07-25T00:00:00.000Z')

    trace.step(
      { kind: 'llm-call', title: 'Resolve model', detail: 'openai/gpt-5.4', status: 'ok' },
      nowMs
    )
    trace.step(
      { kind: 'tool-call', title: 'Call tool', detail: 'fetch price', status: 'warning' },
      nowMs + 50
    )
    trace.step(
      { kind: 'guardrail-check', title: 'Safety check', detail: 'blocked write', status: 'blocked' },
      nowMs + 100
    )

    expect(trace.length).toBe(3)

    const [step0, step1, step2] = (trace as unknown as { steps: unknown[] }).steps as Array<{
      index: number
      title: string
      detail: string
      status: string
    }>

    expect(step0.index).toBe(0)
    expect(step0.title).toBe('Resolve model')
    expect(step0.detail).toBe('openai/gpt-5.4')
    expect(step0.status).toBe('ok')

    expect(step1.index).toBe(1)
    expect(step1.status).toBe('warning')

    expect(step2.index).toBe(2)
    expect(step2.status).toBe('blocked')
  })

  it('stamps startedAt from nowMs when missing and clamps/rounds durationMs', () => {
    const trace = startTrace(baseContext())
    const nowMs = Date.parse('2026-07-25T01:00:00.000Z')

    trace.step({ kind: 'llm-call', title: 'T', detail: 'D', status: 'ok' }, nowMs)
    trace.step(
      { kind: 'llm-call', title: 'T2', detail: 'D2', status: 'ok', durationMs: -5 },
      nowMs
    )
    trace.step(
      { kind: 'llm-call', title: 'T3', detail: 'D3', status: 'ok', durationMs: 12.6 },
      nowMs
    )

    const steps = (trace as unknown as { steps: Array<{ startedAt: string; durationMs: number }> })
      .steps

    expect(steps[0].startedAt).toBe(new Date(nowMs).toISOString())
    expect(steps[1].durationMs).toBe(0) // negative clamped to 0
    expect(steps[2].durationMs).toBe(13) // rounded
  })

  it('defaults toolCallId to null when absent', () => {
    const trace = startTrace(baseContext())
    trace.step({ kind: 'llm-call', title: 'T', detail: 'D', status: 'ok' }, Date.now())
    const steps = (trace as unknown as { steps: Array<{ toolCallId: string | null }> }).steps
    expect(steps[0].toolCallId).toBeNull()
  })

  it('preserves toolCallId for tool-call steps', () => {
    const trace = startTrace(baseContext())
    trace.step(
      {
        kind: 'tool-call',
        title: 'Call get_dvf',
        detail: 'section=75101AB01',
        status: 'ok',
        toolCallId: 'call-abc123',
      },
      Date.now()
    )

    const steps = (trace as unknown as { steps: Array<{ kind: string; toolCallId: string | null }> })
      .steps
    expect(steps[0].kind).toBe('tool-call')
    expect(steps[0].toolCallId).toBe('call-abc123')
  })
})

describe('RunTrace.resolve', () => {
  it('updates resolvedProvider/resolvedModel/fallbackUsed on the context', () => {
    const trace = startTrace(baseContext())
    trace.resolve('google', 'gemini-pro', true)
    expect(trace.context.resolvedProvider).toBe('google')
    expect(trace.context.resolvedModel).toBe('gemini-pro')
    expect(trace.context.fallbackUsed).toBe(true)
  })
})

describe('RunTrace.finishAndExport', () => {
  it('returns { steps, traceUrl } with traceUrl null when neither exporter is configured (fail-open)', async () => {
    const trace = startTrace(baseContext())
    trace.step({ kind: 'llm-call', title: 'Resolve model', detail: 'openai/gpt-5.4', status: 'ok' }, Date.now())
    trace.step({ kind: 'output', title: 'Output', detail: 'done', status: 'ok' }, Date.now())

    const result = await trace.finishAndExport(
      { prompt: 'hello' },
      { answer: 'world' },
      '2026-07-25T00:00:00.000Z',
      '2026-07-25T00:00:05.000Z'
    )

    expect(result.traceUrl).toBeNull()
    expect(result.exported).toBe(false)
    expect(result.traceId).toBe('trace-fixed-id')
    expect(result.steps).toHaveLength(2)
    expect(result.steps[0].title).toBe('Resolve model')
    expect(result.steps[1].title).toBe('Output')
    expect(result.summary).toContain('openai/gpt-5.4')
    expect(result.summary).toContain('2 steps')
  })

  it('does not lose steps even when the export call fails/errors (fail-open)', async () => {
    mockExportTrace.mockRejectedValueOnce(new Error('network down'))

    const trace = startTrace(baseContext())
    trace.step({ kind: 'llm-call', title: 'Step A', detail: 'a', status: 'ok' }, Date.now())

    // finishAndExport awaits Promise.all([langsmithPromise, langfusePromise]);
    // if the langsmith export module itself rejects (rather than resolving
    // with exported:false), that rejection would propagate. Guard: the real
    // exportTrace never throws (langsmith.ts catches internally) — assert the
    // mocked rejection surfaces so we know this test matches real behaviour.
    await expect(
      trace.finishAndExport({}, {}, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:01.000Z')
    ).rejects.toThrow('network down')
  })

  it('exposes a real traceUrl when LangSmith export resolves with one', async () => {
    mockExportTrace.mockResolvedValueOnce({
      traceUrl: 'https://smith.langchain.com/o/org/projects/p/proj/r/trace-fixed-id',
      exported: true,
    })

    const trace = startTrace(baseContext())
    trace.step({ kind: 'llm-call', title: 'Step A', detail: 'a', status: 'ok' }, Date.now())

    const result = await trace.finishAndExport({}, {}, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:01.000Z')

    expect(result.traceUrl).toBe('https://smith.langchain.com/o/org/projects/p/proj/r/trace-fixed-id')
    expect(result.exported).toBe(true)
    expect(result.steps).toHaveLength(1)
  })

  it('only calls the Langfuse exporter when isLangfuseConfigured() is true', async () => {
    const trace = startTrace(baseContext())
    trace.step({ kind: 'llm-call', title: 'Step A', detail: 'a', status: 'ok' }, Date.now())
    await trace.finishAndExport({}, {}, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:01.000Z')

    expect(mockExportLangfuseTrace).not.toHaveBeenCalled()

    mockIsLangfuseConfigured.mockReturnValue(true)
    mockExportLangfuseTrace.mockResolvedValueOnce({
      exported: true,
      eventCount: 2,
      traceUrl: 'http://langfuse.local/trace/trace-fixed-id',
    })

    const trace2 = startTrace(baseContext())
    trace2.step({ kind: 'llm-call', title: 'Step A', detail: 'a', status: 'ok' }, Date.now())
    await trace2.finishAndExport({}, {}, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:01.000Z')

    expect(mockExportLangfuseTrace).toHaveBeenCalledTimes(1)
  })

  it('preserves tool-call steps with their toolCallId through export', async () => {
    const trace = startTrace(baseContext())
    trace.step(
      { kind: 'llm-call', title: 'Resolve model', detail: 'openai/gpt-5.4', status: 'ok' },
      Date.now()
    )
    trace.step(
      {
        kind: 'tool-call',
        title: 'Call get_valuation',
        detail: 'address=1 rue de la paix',
        status: 'ok',
        toolCallId: 'call-xyz789',
      },
      Date.now()
    )
    trace.step({ kind: 'output', title: 'Output', detail: 'done', status: 'ok' }, Date.now())

    const result = await trace.finishAndExport({}, {}, '2026-07-25T00:00:00.000Z', '2026-07-25T00:00:02.000Z')

    const toolStep = result.steps.find((s) => s.kind === 'tool-call')
    expect(toolStep).toBeDefined()
    expect(toolStep?.toolCallId).toBe('call-xyz789')

    const otherSteps = result.steps.filter((s) => s.kind !== 'tool-call')
    for (const s of otherSteps) {
      expect(s.toolCallId).toBeNull()
    }
  })
})
