import { describe, expect, it, vi } from 'vitest'

/**
 * `getAgentDetail` now carries `telemetry: RuntimeTelemetrySummary | null` —
 * the DEPLOYED agent's own reported lifecycle pings (`runtime_telemetry_events`),
 * read via `summarizeRuntimeTelemetry` (`runtime-telemetry-store.ts`). This is a
 * SEPARATE channel from `detail.runs`/`detail.metrics`, which are Aigent's own
 * executed runs (`agent_runs`).
 *
 * Unlike `delivery` (agent-detail-delivery.test.ts), this field is NOT part of
 * the resolver's fail-hard `Promise.all` — a telemetry lookup failure must not
 * take down the whole agent-detail page over a channel that is opt-in and
 * write-mostly by design (AGENTS.md, telemetry-health.ts doctrine). So:
 *  · reporting agent, events exist → `detail.telemetry` is the real summary.
 *  · reporting agent, zero events  → `detail.telemetry.totalRuns === 0`, a
 *    MEASURED zero — never collapsed into "lookup failed".
 *  · lookup failed (PostgREST error/timeout) → `detail.telemetry` is `null`,
 *    and the REST of the page still resolves (copilot/runs/manifest are
 *    unaffected) — this is the one field this resolver catches locally.
 *
 * Pure, OFFLINE: `data.ts`, `available-agents.ts`, `delivery-events-store.ts`
 * and `runtime-telemetry-store.ts` are all mocked. NO network, NO DB, NO secret.
 */

import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { RuntimeTelemetrySummary } from '@/lib/agent-mission-control/runtime-telemetry-store'
import type { Copilot } from '@/lib/agent-mission-control/types'

let mockSummarizeImpl: (() => Promise<RuntimeTelemetrySummary>) | null = null

const mockAgent: AvailableAgent = {
  copilotId: 'cop-1',
  projectId: 'proj-1',
  name: 'Test Agent',
  description: null,
  version: 'v1',
  status: 'active',
  lifecycleStatus: 'active',
  runtime: 'langgraph',
  executable: true,
  provider: 'openai',
  configuredModel: 'gpt-5.4',
  executedModel: null,
  tools: [],
  capabilities: [],
  readOnly: true,
  requiresHumanApproval: false,
  lastRunAt: null,
  lastRunStatus: null,
  lastRunCostUsd: null,
  unavailableFields: [],
  unresolvedToolIds: [],
}

const mockCopilot: Copilot = {
  id: 'cop-1',
  projectId: 'proj-1',
  name: 'Test Agent',
  slug: 'test-agent',
  description: null,
  status: 'active',
  runtime: 'langgraph',
  model: 'gpt-5.4',
  modelProvider: 'openai',
  productionVersionId: null,
  latestVersionId: null,
  targetProjectIds: [],
  assistantId: null,
  createdVia: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Copilot

const emptyProvenance: RuntimeTelemetrySummary['measurement'] = {
  tokens: 'NOT_APPLICABLE',
  cost: 'NOT_APPLICABLE',
  errorCategories: 'NOT_APPLICABLE',
  toolSignals: 'NOT_APPLICABLE',
}

const emptyToolSignals: RuntimeTelemetrySummary['toolSignals'] = {
  state: 'NOT_APPLICABLE',
  runsWithToolSignal: null,
  runsExecutedWithoutTools: null,
  runsInvokedTools: null,
}

vi.mock('@/lib/agent-mission-control/available-agents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/available-agents')>(
    '@/lib/agent-mission-control/available-agents'
  )
  return {
    ...actual,
    getAvailableAgent: vi.fn(async () => mockAgent),
  }
})

vi.mock('@/lib/agent-mission-control/data', () => ({
  getCopilot: vi.fn(async () => mockCopilot),
  getManifestForCopilot: vi.fn(async () => undefined),
  getRunsForCopilot: vi.fn(async () => []),
  getToolsForCopilot: vi.fn(async () => []),
  getVersionsForCopilot: vi.fn(async () => []),
  getProject: vi.fn(async () => undefined),
  getTestSuitesForCopilot: vi.fn(async () => []),
  getBenchmarkSuitesForCopilot: vi.fn(async () => []),
}))

vi.mock('@/lib/agent-mission-control/delivery-events-store', () => ({
  getLatestDeliveryEvent: vi.fn(async () => null),
}))

vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  summarizeRuntimeTelemetry: vi.fn(async () => {
    if (mockSummarizeImpl) return mockSummarizeImpl()
    throw new Error('summarizeRuntimeTelemetry not mocked for this test')
  }),
  getLatestTelemetryEventForCopilot: vi.fn(async () => null),
}))

describe('getAgentDetail — runtime telemetry exposure', () => {
  it('a healthy reporting agent carries the real summary, terminal counts split out real', async () => {
    mockSummarizeImpl = async () => ({
      totalRuns: 12,
      completedRuns: 10,
      failedRuns: 1,
      startedRuns: 1,
      successRate: 10 / 11,
      failureRate: 1 / 11,
      avgLatencyMs: 820,
      p95LatencyMs: 1500,
      totalTokens: null,
      totalCostUsd: null,
      costEstimated: false,
      topErrorCategories: [],
      measurement: emptyProvenance,
      toolSignals: emptyToolSignals,
      lastSeenAt: '2026-07-30T09:00:00Z',
    })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.telemetry).not.toBeNull()
    expect(detail!.telemetry!.totalRuns).toBe(12)
    expect(detail!.telemetry!.completedRuns).toBe(10)
    expect(detail!.telemetry!.failedRuns).toBe(1)
  })

  it('an agent that has never reported telemetry gets a MEASURED zero, not a null', async () => {
    mockSummarizeImpl = async () => ({
      totalRuns: 0,
      completedRuns: 0,
      failedRuns: 0,
      startedRuns: 0,
      successRate: null,
      failureRate: null,
      avgLatencyMs: null,
      p95LatencyMs: null,
      totalTokens: null,
      totalCostUsd: null,
      costEstimated: false,
      topErrorCategories: [],
      measurement: emptyProvenance,
      toolSignals: emptyToolSignals,
      lastSeenAt: null,
    })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.telemetry).not.toBeNull()
    expect(detail!.telemetry!.totalRuns).toBe(0)
    expect(detail!.telemetry!.lastSeenAt).toBeNull()
  })

  it('a telemetry lookup failure is caught locally: detail.telemetry is null, the rest of the page still resolves', async () => {
    mockSummarizeImpl = async () => {
      throw new Error('runtime_telemetry_events unreachable')
    }
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.telemetry).toBeNull()
    // the rest of the resolver is unaffected by a telemetry-only failure
    expect(detail!.copilot).toEqual(mockCopilot)
  })

  it('a partial-signal agent preserves cost estimation and tool-signal provenance verbatim', async () => {
    mockSummarizeImpl = async () => ({
      totalRuns: 5,
      completedRuns: 5,
      failedRuns: 0,
      startedRuns: 0,
      successRate: 1,
      failureRate: 0,
      avgLatencyMs: 400,
      p95LatencyMs: 600,
      totalTokens: 12000,
      totalCostUsd: 0.42,
      costEstimated: true,
      topErrorCategories: [],
      measurement: { ...emptyProvenance, tokens: 'MEASURED', cost: 'MEASURED', toolSignals: 'MEASURED' },
      toolSignals: { state: 'MEASURED', runsWithToolSignal: 5, runsExecutedWithoutTools: 1, runsInvokedTools: 4 },
      lastSeenAt: '2026-07-30T08:00:00Z',
    })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail!.telemetry!.costEstimated).toBe(true)
    expect(detail!.telemetry!.toolSignals.runsInvokedTools).toBe(4)
    expect(detail!.telemetry!.measurement.tokens).toBe('MEASURED')
  })
})
