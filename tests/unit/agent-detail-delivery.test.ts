import { describe, expect, it, vi } from 'vitest'

/**
 * `getAgentDetail` now carries `delivery: DeliveryEvent | null` — the latest
 * `agent_delivery_events` row for the copilot (`getLatestDeliveryEvent`,
 * `delivery-events-store.ts`). This is a real persisted table (migration
 * 0015), already read for the aggregate dashboard counters
 * (`dashboard-overview.ts`) but never before surfaced per-agent.
 *
 * Three cases, matching the resolver's own fail-hard contract (every field in
 * `getAgentDetail`'s `Promise.all` rejects the whole call on a read error —
 * there is no per-field fail-soft in this resolver, and delivery does not
 * invent one):
 *  · delivered   → `detail.delivery` is the real row, not a derived guess.
 *  · never delivered → `detail.delivery` is `null` — a MEASURED absence, not
 *    "unknown". This must never collapse into a false "healthy" reading.
 *  · read failed → `getAgentDetail` itself rejects, exactly like a manifest
 *    or copilot read failure already does. No silent empty delivery.
 *
 * Pure, OFFLINE: `data.ts`, `available-agents.ts` and
 * `delivery-events-store.ts` are mocked. NO network, NO DB, NO secret.
 */

import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { Copilot } from '@/lib/agent-mission-control/types'

let mockDelivery: DeliveryEvent | null = null
let mockDeliveryImpl: (() => Promise<DeliveryEvent | null>) | null = null

const mockAgent: AvailableAgent = {
  copilotId: 'cop-1',
  projectId: 'proj-1',
  name: 'Test Agent',
  description: null,
  version: 'v1',
  versionStage: 'production',
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
  getLatestDeliveryEvent: vi.fn(async () => {
    if (mockDeliveryImpl) return mockDeliveryImpl()
    return mockDelivery
  }),
}))

vi.mock('@/lib/agent-mission-control/improvement-loop', () => ({
  getLatestProposalForCopilot: vi.fn(async () => null),
}))

vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  getLatestTelemetryEventForCopilot: vi.fn(async () => null),
  summarizeRuntimeTelemetry: vi.fn(async () => null),
}))

describe('getAgentDetail — delivery exposure', () => {
  it('a delivered agent carries the real delivery row, not a derived guess', async () => {
    mockDeliveryImpl = null
    mockDelivery = {
      id: 'evt-1',
      mode: 'pull_request',
      targetRepo: 'org/consumer-repo',
      targetBranch: 'main',
      deliveryBranch: 'aigent/deliver-cop-1',
      commitSha: null,
      commitUrl: null,
      prUrl: 'https://github.com/org/consumer-repo/pull/42',
      prNumber: 42,
      status: 'ready_for_manual_test',
      createdAt: '2026-07-29T10:00:00Z',
    }
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.delivery).toEqual(mockDelivery)
  })

  it('an agent never delivered is a MEASURED null, not a missing/unknown state', async () => {
    mockDeliveryImpl = null
    mockDelivery = null
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.delivery).toBeNull()
  })

  it('a failed delivery read rejects the whole resolver — no silent empty delivery', async () => {
    mockDeliveryImpl = async () => {
      throw new Error('agent_delivery_events unreachable')
    }
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    await expect(getAgentDetail('cop-1')).rejects.toThrow('agent_delivery_events unreachable')
  })
})
