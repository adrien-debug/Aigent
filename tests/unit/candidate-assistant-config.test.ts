/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — candidate-faithful assistant config.
 *
 * The un-blocker for real LangGraph candidate execution (the directive's points
 * 2–3, and the fix for the KNOWN LIMITATION in shadow-replay-routes-shared.ts).
 * These offline tests pin the two properties that make it faithful and safe,
 * WITHOUT reaching the Agent Server:
 *   - the config is built from the CANDIDATE version's OWN manifest
 *     (copilot_versions.manifest_id), so a candidate that changed its
 *     prompt/budget is reflected — not the copilot's latest manifest;
 *   - the ephemeral assistant id is VERSION-scoped and can never equal the
 *     copilot's production assistant id, so provisioning it leaves production
 *     untouched.
 *
 * The provisioning that consumes this (ensureCandidateAssistant) reaches the
 * Agent Server and a real billed candidate run is an agreement-gated step — NOT
 * exercised here (see tests/unit/deterministic-evidence-*).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Guard the module import: loadCandidateBehaviorConfig never calls the server
// client, but the module imports the factory — stub it so no real client is built.
vi.mock('@/lib/agent-mission-control/langgraph-client', () => ({
  agentServerClient: () => {
    throw new Error('agent server client must not be built in this test')
  },
  AGENT_BUILDER_GRAPH_ID: 'agent_builder',
}))

const pgrest = vi.fn()
vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return { ...actual, pgrest }
})

const { loadCandidateBehaviorConfig, assistantIdForCandidate, assistantIdForCopilot } = await import(
  '@/lib/agent-mission-control/langgraph-assistants'
)

const COPILOT = 'copilot-cand'
const VERSION = 'ver-cand'
const CANDIDATE_MANIFEST = 'manifest-candidate'
const CANDIDATE_PROMPT = 'CANDIDATE-PROMPT-MARKER count words precisely'

beforeEach(() => {
  pgrest.mockReset()
  pgrest.mockImplementation(async (_method: string, path: string) => {
    if (path.startsWith('copilot_versions?')) return [{ id: VERSION, copilot_id: COPILOT, manifest_id: CANDIDATE_MANIFEST }]
    if (path.startsWith('copilots?')) {
      return [{ id: COPILOT, name: 'Candidate Agent', model: 'gpt-5.4', model_provider: 'openai', project_id: null }]
    }
    if (path.startsWith('manifests?')) {
      // The candidate manifest resolved BY the version's manifest_id. Its
      // distinctive prompt + step budget must show up in the built config.
      return [
        {
          system_prompt_summary: CANDIDATE_PROMPT,
          forbidden_actions: [],
          confirmation_policy: 'never',
          always_confirm_actions: [],
          output_contract: { format: 'json', schemaName: null, invariants: [] },
          max_steps_per_run: 7,
          max_cost_per_run_usd: 0.5,
        },
      ]
    }
    if (path.startsWith('tools?')) return []
    return []
  })
})

describe('loadCandidateBehaviorConfig — faithful to the candidate version manifest', () => {
  it('resolves the manifest by the VERSION manifest_id, not the copilot latest', async () => {
    const { config, copilotId, projectId } = await loadCandidateBehaviorConfig(VERSION)
    expect(copilotId).toBe(COPILOT)
    expect(projectId).toBeNull()
    // The candidate's own prompt + budget flowed into the config.
    expect(config.systemPrompt).toContain('CANDIDATE-PROMPT-MARKER')
    expect(config.maxSteps).toBe(7)
    // It read manifests BY id (the candidate's), not by copilot_id+latest.
    const manifestQuery = pgrest.mock.calls.map((c) => c[1] as string).find((p) => p.startsWith('manifests?'))
    expect(manifestQuery).toContain(`id=eq.${CANDIDATE_MANIFEST}`)
    expect(manifestQuery).not.toContain('order=updated_at.desc')
  })

  it('throws for a phantom version rather than provisioning against nothing', async () => {
    pgrest.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith('copilot_versions?')) return []
      return []
    })
    await expect(loadCandidateBehaviorConfig('ghost-version')).rejects.toThrow(/candidate version not found/)
  })
})

describe('assistantIdForCandidate — a distinct, version-scoped entity', () => {
  it('is NEVER the copilot production assistant id', () => {
    expect(assistantIdForCandidate(VERSION)).not.toBe(assistantIdForCopilot(COPILOT))
    // Even when the version id and copilot id collide as strings, the namespaces differ.
    expect(assistantIdForCandidate(COPILOT)).not.toBe(assistantIdForCopilot(COPILOT))
  })

  it('is deterministic (same version → same id) and a valid UUID', () => {
    const a = assistantIdForCandidate(VERSION)
    expect(a).toBe(assistantIdForCandidate(VERSION))
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})
