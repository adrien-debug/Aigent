/**
 * Unit tests for runtime-telemetry-store.ts
 * (src/lib/agent-mission-control/runtime-telemetry-store.ts).
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 * Covers insert (fail-soft), list (filter), summarize (success rate, avg/p95
 * latency, top error categories, empty-data nulls), and a light integration
 * check that collectImprovementSignals() stays fail-soft when the runtime
 * telemetry table/backend is unavailable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const COPILOT_ID = 'copilot-telemetry-test'
const PROJECT_ID = 'project-telemetry-test'
const AGENT_ID = 'agent-telemetry-test'

type PgrestHandler = (method: string, path: string, body?: unknown) => unknown

let pgrestHandler: PgrestHandler
const pgrestCalls: Array<{ method: string; path: string; body?: unknown }> = []

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    pgrestCalls.push({ method, path, body })
    return pgrestHandler(method, path, body)
  }),
}))

import {
  insertRuntimeTelemetryEvent,
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
  summarizeRuntimeTelemetry,
  type RuntimeTelemetryEvent,
} from '@/lib/agent-mission-control/runtime-telemetry-store'

function makeEvent(overrides: Partial<RuntimeTelemetryEvent> = {}): RuntimeTelemetryEvent {
  return {
    id: 'event-1',
    projectId: PROJECT_ID,
    agentId: AGENT_ID,
    agentVersion: null,
    targetRepo: null,
    runId: 'run-1',
    provider: 'openai',
    model: 'gpt-5.4',
    status: 'completed',
    latencyMs: 120,
    inputShape: {},
    outputShape: {},
    error: {},
    usage: {},
    environment: {},
    receivedAt: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

/** Builds a raw (snake_case) row as PostgREST would echo it back. */
function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'event-1',
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    agent_version: null,
    target_repo: null,
    run_id: 'run-1',
    provider: 'openai',
    model: 'gpt-5.4',
    status: 'completed',
    latency_ms: 120,
    input_shape: {},
    output_shape: {},
    error: {},
    usage: {},
    environment: {},
    received_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('runtime-telemetry-store', () => {
  beforeEach(() => {
    pgrestCalls.length = 0
    pgrestHandler = () => {
      throw new Error('pgrestHandler not configured for this test')
    }
  })

  describe('insertRuntimeTelemetryEvent', () => {
    it('1a — posts the event with the right method/path/body shape', async () => {
      pgrestHandler = () => [rawRow()]

      await insertRuntimeTelemetryEvent(makeEvent())

      expect(pgrestCalls).toHaveLength(1)
      expect(pgrestCalls[0].method).toBe('POST')
      expect(pgrestCalls[0].path).toBe('runtime_telemetry_events')
      expect(pgrestCalls[0].body).toMatchObject({
        id: 'event-1',
        project_id: PROJECT_ID,
        agent_id: AGENT_ID,
        run_id: 'run-1',
        status: 'completed',
        latency_ms: 120,
      })
    })

    it('1b — never throws even when pgrest rejects (fail-soft)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      pgrestHandler = () => {
        throw new Error('PostgREST 503 on POST runtime_telemetry_events')
      }

      await expect(insertRuntimeTelemetryEvent(makeEvent())).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith('[runtime-telemetry-store] insert failed', expect.any(String))

      errorSpy.mockRestore()
    })

    it('1c — swallows a rejected promise from pgrest too (fail-soft, non-Error throw)', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      pgrestHandler = () => {
        throw 'backend unreachable'
      }

      await expect(insertRuntimeTelemetryEvent(makeEvent())).resolves.toBeUndefined()
      expect(errorSpy).toHaveBeenCalledWith('[runtime-telemetry-store] insert failed', 'backend unreachable')

      errorSpy.mockRestore()
    })
  })

  describe('summarizeRuntimeTelemetry', () => {
    it('3 — computes success rate over terminal runs (7 completed / 3 failed ≈ 0.7)', async () => {
      const rows = [
        ...Array.from({ length: 7 }, (_, i) => rawRow({ id: `ok-${i}`, status: 'completed', latency_ms: 100 })),
        ...Array.from({ length: 3 }, (_, i) => rawRow({ id: `bad-${i}`, status: 'failed', latency_ms: 100, error: { category: 'timeout' } })),
      ]
      pgrestHandler = () => rows

      const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

      expect(summary.totalRuns).toBe(10)
      expect(summary.successRate).toBeCloseTo(0.7, 5)
      expect(summary.failureRate).toBeCloseTo(0.3, 5)
    })

    it('4 — computes avg and p95 latency on a hand-computable dataset', async () => {
      // 20 events, latencies 10..200 step 10 (ms). Sorted ascending already.
      const latencies = Array.from({ length: 20 }, (_, i) => (i + 1) * 10) // 10..200
      const rows = latencies.map((ms, i) => rawRow({ id: `evt-${i}`, status: 'completed', latency_ms: ms }))
      pgrestHandler = () => rows

      const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

      // avg = (10+20+...+200)/20 = 2100/20 = 105
      expect(summary.avgLatencyMs).toBe(105)
      // p95: idx = min(19, ceil(20*0.95)-1) = min(19, 19-... ) -> ceil(19)-1 = 18 -> sortedAsc[18] = 190
      expect(summary.p95LatencyMs).toBe(190)
    })

    it('5 — top error categories sorted by count descending', async () => {
      const rows = [
        ...Array.from({ length: 5 }, (_, i) => rawRow({ id: `timeout-${i}`, status: 'failed', error: { category: 'timeout' } })),
        ...Array.from({ length: 2 }, (_, i) => rawRow({ id: `auth-${i}`, status: 'failed', error: { category: 'auth' } })),
        rawRow({ id: 'rate-limit-0', status: 'failed', error: { category: 'rate_limit' } }),
        rawRow({ id: 'uncategorized-0', status: 'failed', error: {} }),
        rawRow({ id: 'ok-0', status: 'completed' }),
      ]
      pgrestHandler = () => rows

      const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

      expect(summary.topErrorCategories[0]).toEqual({ category: 'timeout', count: 5 })
      expect(summary.topErrorCategories[1]).toEqual({ category: 'auth', count: 2 })
      // remaining single-count categories, order among ties not asserted
      const remaining = summary.topErrorCategories.slice(2).map((c) => c.category).sort()
      expect(remaining).toEqual(['rate_limit', 'uncategorized'])
      // counts strictly non-increasing
      for (let i = 1; i < summary.topErrorCategories.length; i++) {
        expect(summary.topErrorCategories[i].count).toBeLessThanOrEqual(summary.topErrorCategories[i - 1].count)
      }
    })

    it('6 — empty event list returns null/zero metrics, no throw', async () => {
      pgrestHandler = () => []

      const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

      expect(summary).toEqual({
        totalRuns: 0,
        successRate: null,
        failureRate: null,
        avgLatencyMs: null,
        p95LatencyMs: null,
        totalTokens: null,
        topErrorCategories: [],
        lastSeenAt: null,
      })
    })

    it('propagates a hard PostgREST error (read edges throw; callers wrap fail-soft)', async () => {
      pgrestHandler = () => {
        throw new Error('PostgREST 500 on GET runtime_telemetry_events')
      }

      await expect(summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)).rejects.toThrow(/PostgREST 500/)
    })
  })

  describe('summarizeFleetRuntimeTelemetry', () => {
    it('7 — aggregates fleet-wide totals and groups per (project, agent)', async () => {
      const rows = [
        rawRow({ id: 'a1', project_id: 'proj-a', agent_id: 'agent-a', status: 'completed', latency_ms: 100 }),
        rawRow({ id: 'a2', project_id: 'proj-a', agent_id: 'agent-a', status: 'failed', latency_ms: 200, error: { category: 'timeout' } }),
        rawRow({ id: 'b1', project_id: 'proj-b', agent_id: 'agent-b', status: 'completed', latency_ms: 300 }),
      ]
      pgrestHandler = () => rows

      const summary = await summarizeFleetRuntimeTelemetry()

      expect(summary.totalRuns).toBe(3)
      expect(summary.reportingAgents).toBe(2)
      expect(summary.successRate).toBeCloseTo(2 / 3, 5)
      expect(summary.topErrorCategories).toEqual([{ category: 'timeout', count: 1 }])

      const agentA = summary.byAgent.find((a) => a.agentId === 'agent-a')
      const agentB = summary.byAgent.find((a) => a.agentId === 'agent-b')
      expect(agentA).toMatchObject({ projectId: 'proj-a', totalRuns: 2, successRate: 0.5 })
      expect(agentB).toMatchObject({ projectId: 'proj-b', totalRuns: 1, successRate: 1 })
    })

    it('8 — empty event list returns zero/null metrics and an empty byAgent list, no throw', async () => {
      pgrestHandler = () => []

      const summary = await summarizeFleetRuntimeTelemetry()

      expect(summary.totalRuns).toBe(0)
      expect(summary.reportingAgents).toBe(0)
      expect(summary.successRate).toBeNull()
      expect(summary.byAgent).toEqual([])
    })

    it('propagates a hard PostgREST error (read edges throw; callers wrap fail-soft)', async () => {
      pgrestHandler = () => {
        throw new Error('PostgREST 500 on GET runtime_telemetry_events')
      }

      await expect(summarizeFleetRuntimeTelemetry()).rejects.toThrow(/PostgREST 500/)
    })
  })

  describe('listRecentRuntimeTelemetryEvents', () => {
    it('9 — fetches across all projects/agents, newest first, and maps rows', async () => {
      pgrestHandler = (_method, path) => {
        expect(path).toContain('order=received_at.desc')
        expect(path).not.toContain('project_id=eq.')
        expect(path).not.toContain('agent_id=eq.')
        return [rawRow({ id: 'evt-1' }), rawRow({ id: 'evt-2', project_id: 'proj-other', agent_id: 'agent-other' })]
      }

      const events = await listRecentRuntimeTelemetryEvents()

      expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2'])
      expect(events[1].projectId).toBe('proj-other')
    })

    it('9b — respects a custom limit in the query', async () => {
      pgrestHandler = (_method, path) => {
        expect(path).toContain('limit=5')
        return []
      }

      await listRecentRuntimeTelemetryEvents(5)
      expect(pgrestCalls).toHaveLength(1)
    })
  })
})

describe('collectImprovementSignals — runtime telemetry fail-soft integration', () => {
  beforeEach(() => {
    pgrestCalls.length = 0
    vi.resetModules()
  })

  it('keeps sources.runtimeTelemetry=false and never throws when the telemetry table/backend is down', async () => {
    vi.doMock('@/lib/agent-mission-control/postgrest', () => ({
      pgrest: vi.fn(async (method: string, path: string) => {
        pgrestCalls.push({ method, path })

        if (path.startsWith('copilots?')) {
          return [{ id: COPILOT_ID, project_id: PROJECT_ID, production_version_id: null, latest_version_id: 'version-1', name: 'Test Copilot' }]
        }
        if (path.startsWith('copilot_versions?')) {
          return [{ id: 'version-1', label: 'v1', stage: 'production', manifest_id: 'manifest-1' }]
        }
        if (path.startsWith('manifests?')) {
          return [{ id: 'manifest-1', system_prompt_summary: '', forbidden_actions: [], confirmation_policy: 'risky-only', always_confirm_actions: [], output_contract: {}, max_steps_per_run: 12 }]
        }
        if (path.startsWith('test_suites?')) return []
        if (path.startsWith('test_cases?')) return []
        if (path.startsWith('test_runs?')) return []
        if (path.startsWith('test_results?')) return []
        if (path.startsWith('tools?')) return []
        if (path.startsWith('benchmark_suites?')) return []
        if (path.startsWith('benchmark_runs?')) return []
        if (path.startsWith('benchmark_results?')) return []
        if (path.startsWith('agent_runs?')) return []
        // Simulate the runtime_telemetry_events table/backend being down —
        // this is the call summarizeRuntimeTelemetry() makes internally.
        if (path.startsWith('runtime_telemetry_events?')) {
          throw new Error('PostgREST 503 on GET runtime_telemetry_events (backend down)')
        }
        throw new Error(`Unmocked pgrest path in integration test: ${path}`)
      }),
    }))

    const { collectImprovementSignals } = await import('@/lib/agent-mission-control/improvement-loop')

    await expect(collectImprovementSignals(COPILOT_ID)).resolves.toBeDefined()
    const signals = await collectImprovementSignals(COPILOT_ID)

    expect(signals.sources.db).toBe(true)
    expect(signals.sources.runtimeTelemetry).toBe(false)
    expect(signals.sources.runtimeTelemetryReason).toMatch(/PostgREST 503|backend down/i)
    expect(signals.runtimeTelemetry).toBeUndefined()

    const telemetryCalls = pgrestCalls.filter((c) => c.path.startsWith('runtime_telemetry_events?'))
    expect(telemetryCalls.length).toBeGreaterThan(0)
  })
})
