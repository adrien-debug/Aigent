import { describe, expect, it, vi } from 'vitest'

/**
 * `getAgentDetail` now carries `lifecycle: LifecycleTrace` — built by
 * `buildLifecycleTrace` (agent-lifecycle-trace.ts) from delivery, versions,
 * the latest improvement proposal, and the latest telemetry event.
 *
 * The telemetry leg is DELIBERATELY fail-soft (unlike every other field in
 * this resolver): telemetry is documented best-effort everywhere else in the
 * codebase, so a telemetry-read failure must degrade the "telemetry_received"
 * stage to unknown, not reject the whole page. Delivery and the proposal
 * lookup are NOT fail-soft — a failure there still rejects, same as before.
 *
 * Pure, OFFLINE: every store this resolver touches is mocked. NO network, NO
 * DB, NO secret.
 */

import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import type { Copilot } from '@/lib/agent-mission-control/types'

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

let telemetryImpl: () => Promise<{ agentVersion: string | null; receivedAt: string } | null> = async () => null

vi.mock('@/lib/agent-mission-control/available-agents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/available-agents')>(
    '@/lib/agent-mission-control/available-agents'
  )
  return { ...actual, getAvailableAgent: vi.fn(async () => mockAgent) }
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

vi.mock('@/lib/agent-mission-control/improvement-loop', () => ({
  getLatestProposalForCopilot: vi.fn(async () => null),
}))

vi.mock('@/lib/agent-mission-control/runtime-telemetry-store', () => ({
  getLatestTelemetryEventForCopilot: vi.fn(async () => telemetryImpl()),
  summarizeRuntimeTelemetry: vi.fn(async () => null),
}))

describe('getAgentDetail — lifecycle trace wiring', () => {
  it('a telemetry read failure degrades the telemetry stage to unknown, without rejecting the page', async () => {
    telemetryImpl = async () => {
      throw new Error('runtime_telemetry_events unreachable')
    }
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    expect(detail).toBeDefined()
    const stage = detail!.lifecycle.stages.find((s) => s.key === 'telemetry_received')!
    expect(stage.reached).toBe('unknown')
    expect(stage.evidence.state).toBe('unknown')
    expect(detail!.lifecycle.versionDrift.state).toBe('unknown')
  })

  it('a successful, empty telemetry read is a MEASURED absence, not unknown', async () => {
    telemetryImpl = async () => null
    const { getAgentDetail } = await import('@/lib/agent-mission-control/agent-detail')
    const detail = await getAgentDetail('cop-1')
    const stage = detail!.lifecycle.stages.find((s) => s.key === 'telemetry_received')!
    expect(stage.reached).toBe(false)
    expect(stage.evidence.state).toBe('measured')
  })
})
