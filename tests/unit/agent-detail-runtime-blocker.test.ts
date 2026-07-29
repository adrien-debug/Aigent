import { describe, expect, it, vi } from 'vitest'

/**
 * `computeBlockers` (agent-detail.ts) must mirror the SAME runtime guard
 * `runtime-catalogue.isExecutable` / `/admin/agents` already apply — a
 * non-langgraph agent is never executable, but that is a single, dedicated
 * reason. Before this fix, `computeBlockers` never checked `agent.runtime`
 * at all, so a non-langgraph agent with `status: 'active'` and no unresolved
 * tools silently reported ZERO blockers (falsely executable) — the same class
 * of two-truths bug this resolver exists to prevent.
 *
 * Pure, OFFLINE: `data.ts` and `available-agents.ts` are mocked. NO network,
 * NO DB, NO model call, NO secret.
 */

import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { Copilot } from '@/lib/agent-mission-control/types'

let mockAgent: AvailableAgent | undefined
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
}))

vi.mock('@/lib/agent-mission-control/delivery-events-store', () => ({
  getLatestDeliveryEvent: vi.fn(async () => null),
}))

function baseAgent(overrides: Partial<AvailableAgent>): AvailableAgent {
  return {
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
    ...overrides,
  }
}

describe('computeBlockers runtime guard (via getAgentDetail)', () => {
  it('runtime langgraph, fully wired, active, no unresolved tools → no runtime blocker, executable', async () => {
    mockAgent = baseAgent({ runtime: 'langgraph', status: 'active', unresolvedToolIds: [] })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.blockers.find((b) => b.code === 'runtime-not-langgraph')).toBeUndefined()
    expect(detail!.executable).toBe(true)
  })

  it('runtime non-langgraph (e.g. "direct"), otherwise healthy → exactly one runtime blocker, no false LangGraph reasons', async () => {
    mockAgent = baseAgent({ runtime: 'direct', status: 'active', unresolvedToolIds: [] })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.blockers).toHaveLength(1)
    expect(detail!.blockers[0]?.code).toBe('runtime-not-langgraph')
    expect(detail!.blockers[0]?.label).toBe('Runtime is direct, not langgraph')
    expect(detail!.executable).toBe(false)
  })

  it('runtime absent/undefined (null) → one runtime blocker naming "unset", consistent wording', async () => {
    mockAgent = baseAgent({ runtime: null, status: 'active', unresolvedToolIds: [] })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    expect(detail!.blockers).toHaveLength(1)
    expect(detail!.blockers[0]?.code).toBe('runtime-not-langgraph')
    expect(detail!.blockers[0]?.label).toBe('Runtime is unset, not langgraph')
    expect(detail!.executable).toBe(false)
  })

  it('real blockers (status, unresolved tools) still fire for a non-langgraph agent, and the runtime blocker does not pile on top', async () => {
    mockAgent = baseAgent({
      runtime: 'direct',
      status: 'degraded',
      unresolvedToolIds: ['tool-x'],
    })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    const codes = detail!.blockers.map((b) => b.code)
    expect(codes).toContain('status')
    expect(codes).toContain('unresolved-tools')
    expect(codes).not.toContain('runtime-not-langgraph')
    expect(detail!.executable).toBe(false)
  })

  it('real blockers unaffected for a langgraph agent: unresolved tools still block, no runtime blocker added', async () => {
    mockAgent = baseAgent({
      runtime: 'langgraph',
      status: 'degraded',
      unresolvedToolIds: ['tool-y'],
    })
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    const codes = detail!.blockers.map((b) => b.code)
    expect(codes).toContain('status')
    expect(codes).toContain('unresolved-tools')
    expect(codes).not.toContain('runtime-not-langgraph')
  })
})
