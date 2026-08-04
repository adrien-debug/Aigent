/**
 * AIGENT-FACTORY-READY-001 — LIVE (real-LangGraph) shadow execution (server only).
 *
 * The REAL, non-fixture `ShadowRunAgent`: it runs the CANDIDATE version through
 * the actual LangGraph runtime via its own EPHEMERAL assistant
 * (`ensureCandidateAssistant`, never the production assistant), so a shadow
 * evaluates the true runtime behaviour — no fixture, no alternate execution path.
 * This module also hosts `runVersionInputLive`, the single shared "run one input
 * through a version's real runtime" helper that live replay reuses.
 *
 * WRITE-SAFETY (why this is a real shadow, not a live serve):
 *   - Every mutating/high-risk tool is created with `requiresConfirmation=true`
 *     (the authoring invariant), and the Agent Server run here NEVER confirms a
 *     tool (blocking `runOnAgentServer`, no confirmedTools). So a mutating tool
 *     hits the graph's `interrupt()` approval checkpoint and is never invoked; the
 *     ShadowToolGate (canonical-registry authority on `mutates`) records it as
 *     `wouldMutate`. Read-only tools execute normally (a read has no side effect).
 *   - Any would-mutate attempt makes the shadow verdict FAIL (runShadowExperiment).
 *
 * Because this drives the real runtime, its evidence is stamped
 * `execution_mode: 'live_langgraph'` by the route — the ONLY mode a REQUIRED
 * promotion-gate shadow check accepts (deterministic_fixture never gates prod).
 *
 * RUNTIME PRECONDITION: the real path reaches the LOCAL LangGraph Agent Server
 * (127.0.0.1:2024) only when Next is launched via the dev-stack (`npm run dev` /
 * scripts/dev-stack.mjs), which overrides `LANGGRAPH_API_URL` to local. Under a
 * bare `next dev`, `resolveAgentServerUrl` fail-closes (throws) because .env.local
 * points at the remote endpoint — never a silent wrong target.
 *
 * The caller MUST invoke the returned `cleanup()` to tear the ephemeral assistant
 * down. Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { liveEvidenceAdapter } from './evidence/live-adapter'
import type { EvidenceToolCall } from './evidence/execution-adapter'
import { deleteCandidateAssistant, ensureCandidateAssistant } from './langgraph-assistants'
import { pgrest } from './postgrest'
import type { ShadowRunAgent } from './shadow'
import type { ModelProvider } from './types'

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`
type RawRow = Record<string, unknown>

export interface CandidateExec {
  copilotId: string
  projectId: string
  model: string
  modelProvider: ModelProvider
  systemPromptSummary: string
  maxSteps: number
}

/** Read a version's execution parameters from its version + copilot + manifest rows.
 *  Shared by the live shadow AND live replay runners. */
export async function loadCandidateExec(candidateVersionId: string): Promise<CandidateExec> {
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

/** The raw result of running ONE input through a version's real runtime. */
export interface VersionRunResult {
  reply: unknown
  /** null = unmeasured (no readable usage) — never a fabricated 0. */
  costUsd: number | null
  toolCalls: EvidenceToolCall[]
  /** Non-null only when the run itself threw (never on a normal interrupt). */
  error: string | null
  latencyMs: number
}

/**
 * Run ONE input through a version's ephemeral assistant on the REAL LangGraph
 * runtime and return the raw leg result. The single shared execution primitive
 * for live shadow + live replay — runs blocking (`stream:false`) and NEVER
 * confirms a tool, so a mutating tool interrupts (never executes). Callers apply
 * their own classification (shadow's tool-gate, replay's outputShape/unsafe).
 */
export async function runVersionInputLive(
  exec: CandidateExec,
  assistantId: string,
  versionId: string,
  input: unknown,
  userLabel: string,
): Promise<VersionRunResult> {
  const startedAt = Date.now()
  let reply: unknown = null
  let costUsd: number | null = null
  let error: string | null = null
  let toolCalls: EvidenceToolCall[] = []
  try {
    const result = await liveEvidenceAdapter.executeAgent({
      copilotId: exec.copilotId,
      runtime: 'langgraph',
      input: typeof input === 'string' ? input : JSON.stringify(input),
      maxSteps: exec.maxSteps,
      versionId,
      projectId: exec.projectId,
      model: exec.model,
      modelProvider: exec.modelProvider,
      systemPromptSummary: exec.systemPromptSummary,
      userLabel,
      assistantId,
      stream: false,
    })
    reply = result.reply
    costUsd = result.costUsd
    toolCalls = result.toolCalls
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return { reply, costUsd, toolCalls, error, latencyMs: Date.now() - startedAt }
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
    const r = await runVersionInputLive(exec, assistantId, candidateVersionId, input, `shadow ${candidateVersionId}`)
    if (r.error !== null) {
      throw new Error(`shadow runtime unavailable: ${r.error}`)
    }

    // Classify each attempted tool through the authoritative gate. A mutating tool
    // interrupted at the confirmation checkpoint (status 'blocked') → recorded as
    // wouldMutate, not executed. A read tool that ran (status 'ok') → executed.
    // (The runtime status vocabulary is 'ok' | 'error' | 'blocked'.)
    const toolAttempts = r.toolCalls.map((tc) => {
      const decision = gate.check(tc.toolName)
      return {
        name: tc.toolName,
        wouldMutate: decision.wouldMutate,
        executed: String(tc.status) === 'ok',
      }
    })

    return {
      ok: r.error === null,
      output: r.reply,
      error: r.error,
      latencyMs: r.latencyMs,
      costUsd: r.costUsd,
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
