/**
 * AIGENT-AUTONOMOUS-FACTORY-001 — POST /api/agent-ops/copilots at the route level.
 *
 *   #6  an assistant-provisioning failure rolls the just-created copilot back
 *       (deleteCopilotCascade) and returns 502 — no half-wired copilot survives.
 *   #1  a full success returns 201 with the honest creation CONTRACT.
 * Offline: every collaborator is mocked; no backend, no provider call.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const deleteCopilotCascade = vi.fn(async () => true)
const setCopilotAssistantId = vi.fn(async () => {})
const createCopilotFromManifest = vi.fn(async () => 'copilot-x')
const ensureCopilotAssistant = vi.fn(async () => 'asst-x')
const deleteCopilotAssistant = vi.fn(async () => {})
const describeCandidate = vi.fn(async () => ({
  copilotId: 'copilot-x',
  candidateVersionId: 'version-x',
  manifestId: 'manifest-x',
  runtime: 'langgraph',
  runtimeExecutable: true,
  stage: 'draft',
  assistantProvisioned: true,
  tools: { declared: 0, resolved: 0, certified: 0, phantom: [], uncertified: [] },
  qualification: { state: 'not_started', promotable: false, nextAction: 'start it', blockers: [], candidateVersionId: 'version-x', runId: null, steps: [] },
}))

vi.mock('@/lib/agent-mission-control/authoring-writes', () => ({
  createCopilotFromManifest: () => createCopilotFromManifest(),
  deleteCopilotCascade: (_id: string) => deleteCopilotCascade(),
  setCopilotAssistantId: (_a: string, _b: string) => setCopilotAssistantId(),
  // The route's Zod schema calls this in a superRefine — keep the real contract simple.
  isHighRiskOrWriteCapableTool: () => false,
}))
vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  ensureCopilotAssistant: () => ensureCopilotAssistant(),
  deleteCopilotAssistant: () => deleteCopilotAssistant(),
}))
vi.mock('@/lib/agent-mission-control/agent-autoeval', () => ({ prepareAutoEval: async () => async () => {} }))
vi.mock('@/lib/agent-mission-control/qualification-orchestrator', () => ({ describeCandidate: () => describeCandidate() }))
vi.mock('next/server', async (importActual) => {
  const actual = await importActual<typeof import('next/server')>()
  return { ...actual, after: () => {} }
})

import { POST } from '@/app/api/agent-ops/copilots/route'

const ENV = { AMC_DATA_SOURCE: 'gpu1', AMC_SUPABASE_URL: 'https://gpu1/rest', SUPABASE_SERVICE_ROLE_KEY: 'k' }

function post() {
  return POST(
    new Request('http://localhost/api/agent-ops/copilots', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Agent',
        slug: 'test-agent',
        runtime: 'langgraph',
        model: 'gpt-5.4',
        modelProvider: 'openai',
        owner: 'ops',
        manifest: { confirmationPolicy: 'risky-only', outputContract: { format: 'markdown' }, proposedTools: [], maxStepsPerRun: 10, maxCostPerRunUsd: 1 },
      }),
    }),
  )
}

beforeEach(() => {
  Object.assign(process.env, ENV)
  vi.clearAllMocks()
})
afterEach(() => {
  for (const k of Object.keys(ENV)) delete process.env[k as keyof typeof ENV]
})

describe('POST /api/agent-ops/copilots', () => {
  it('rolls back the copilot and returns 502 when the assistant cannot be provisioned (#6)', async () => {
    ensureCopilotAssistant.mockRejectedValueOnce(new Error('agent server down'))
    const res = await post()
    expect(res.status).toBe(502)
    expect(deleteCopilotCascade).toHaveBeenCalledTimes(1)
    expect(setCopilotAssistantId).not.toHaveBeenCalled()
  })

  it('returns 201 with the honest creation contract on success (#1)', async () => {
    const res = await post()
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, copilotId: 'copilot-x', assistantId: 'asst-x' })
    expect(body.contract).toMatchObject({ runtimeExecutable: true, qualification: { state: 'not_started' } })
    expect(deleteCopilotCascade).not.toHaveBeenCalled()
  })
})
