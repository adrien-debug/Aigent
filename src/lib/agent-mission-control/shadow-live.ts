/**
 * AIGENT-FACTORY-READY-001 — LIVE (real-LangGraph) shadow execution (server only).
 *
 * The REAL, non-fixture `ShadowRunAgent`: it runs the CANDIDATE version through
 * the actual LangGraph runtime via its own EPHEMERAL assistant
 * (`ensureCandidateAssistant`, never the production assistant), so a shadow
 * evaluates the true runtime behaviour — no fixture, no alternate execution path.
 *
 * WRITE-SAFETY (why this is a real shadow, not a live serve):
 *   - Every mutating/high-risk tool is created with `requiresConfirmation=true`
 *     (the authoring invariant, enforced at creation), and the Agent Server run
 *     here NEVER confirms a tool (blocking `runOnAgentServer`, no confirmedTools).
 *     So a mutating tool INTERRUPTS the graph — it is never executed — and the
 *     ShadowToolGate (canonical-registry authority on `mutates`) classifies it as
 *     `wouldMutate`. Read-only tools execute normally (a read has no side effect).
 *   - Any would-mutate attempt makes the shadow verdict FAIL (runShadowExperiment),
 *     exactly as the fixture path does.
 *
 * Because this drives the real runtime, its evidence is stamped
 * `execution_mode: 'live_langgraph'` by the route — the ONLY mode a REQUIRED
 * promotion-gate shadow check accepts (deterministic_fixture never gates prod).
 *
 * The caller MUST invoke the returned `cleanup()` when the run finishes to tear
 * down the ephemeral candidate assistant.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { liveEvidenceAdapter } from './evidence/live-adapter'
import { deleteCandidateAssistant, ensureCandidateAssistant } from './langgraph-assistants'
import { pgrest } from './postgrest'
import type { ShadowRunAgent } from './shadow'
import type { ModelProvider } from './types'
import type { EvidenceToolCall } from './evidence/execution-adapter'

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`
type RawRow = Record<string, unknown>

interface CandidateExec {
  copilotId: string
  projectId: string
  model: string
  modelProvider: ModelProvider
  systemPromptSummary: string
  maxSteps: number
}

/** Read the candidate's execution parameters from its version + copilot + manifest rows. */
async function loadCandidateExec(candidateVersionId: string): Promise<CandidateExec> {
  const versionRows = await pgrest<RawRow[]>(
    'GET',
    `copilot_versions?${eq('id', candidateVersionId)}&select=copilot_id,model,model_provider,manifest_id`,
  )
  const version = versionRows[0]
  if (!version) throw new Error(`candidate version ${candidateVersionId} not found`)
  const copilotId = version.copilot_id as string
  const [copilot, manifest] = await Promise.all([
    pgrest<RawRow[]>('GET', `copilots?${eq('id', copilotId)}&select=project_id`).then((r) => r[0]),
    version.manifest_id
      ? pgrest<RawRow[]>(
          'GET',
          `manifests?${eq('id', version.manifest_id as string)}&select=system_prompt_summary,max_steps_per_run`,
        ).then((r) => r[0])
      : Promise.resolve(undefined),
  ])
  return {
    copilotId,
    // '' for a copilot with no project — the langgraph agent leg ignores projectId.
    projectId: (copilot?.project_id as string | null) ?? '',
    model: version.model as string,
    modelProvider: version.model_provider as ModelProvider,
    systemPromptSummary: (manifest?.system_prompt_summary as string) ?? '',
    maxSteps: (manifest?.max_steps_per_run as number) ?? 6,
  }
}

/**
 * Build the LIVE shadow run agent for a candidate version. Provisions the
 * ephemeral candidate assistant once; the returned `runAgent` drives one input
 * per call through the real LangGraph runtime and classifies every attempted tool
 * via the injected gate. `cleanup()` tears the assistant down.
 */
export async function makeLiveShadowAgent(
  candidateVersionId: string,
): Promise<{ runAgent: ShadowRunAgent; cleanup: () => Promise<void> }> {
  const exec = await loadCandidateExec(candidateVersionId)
  const assistantId = await ensureCandidateAssistant(candidateVersionId)

  const runAgent: ShadowRunAgent = async (input, gate) => {
    const startedAt = Date.now()
    let reply: unknown = null
    let costUsd: number | null = 0
    let error: string | null = null
    let toolCalls: EvidenceToolCall[] = []
    try {
      const result = await liveEvidenceAdapter.executeAgent({
        copilotId: exec.copilotId,
        runtime: 'langgraph',
        input: typeof input === 'string' ? input : JSON.stringify(input),
        maxSteps: exec.maxSteps,
        versionId: candidateVersionId,
        projectId: exec.projectId,
        model: exec.model,
        modelProvider: exec.modelProvider,
        systemPromptSummary: exec.systemPromptSummary,
        userLabel: `shadow ${candidateVersionId}`,
        assistantId,
        stream: false,
      })
      reply = result.reply
      costUsd = result.costUsd
      toolCalls = result.toolCalls
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    }

    // Classify each attempted tool through the authoritative gate. A mutating
    // tool interrupted at the confirmation gate (status !== 'completed') → recorded
    // as wouldMutate, never executed. A read tool that completed → executed.
    const toolAttempts = toolCalls.map((tc) => {
      const decision = gate.check(tc.toolName)
      return {
        name: tc.toolName,
        wouldMutate: decision.wouldMutate,
        executed: !decision.wouldMutate && String(tc.status) === 'completed',
      }
    })

    return {
      ok: error === null,
      output: reply,
      error,
      latencyMs: Date.now() - startedAt,
      costUsd: costUsd ?? 0,
      toolAttempts,
    }
  }

  return {
    runAgent,
    cleanup: async () => {
      await deleteCandidateAssistant(candidateVersionId)
    },
  }
}
