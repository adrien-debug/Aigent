/**
 * AIGENT-FACTORY-READY-001 — LIVE (real-LangGraph) replay execution (server only).
 *
 * The REAL, non-fixture replay runners. A replay compares a REFERENCE version
 * (production) against a CANDIDATE version over the same inputs. Each side is run
 * through the ACTUAL LangGraph runtime via that version's ephemeral assistant
 * (`ensureCandidateAssistant`) — no fixture, no alternate execution path.
 *
 * WRITE-SAFETY (same guarantee as live shadow): the run never confirms a tool, so
 * a mutating tool interrupts (never executes); it is counted in `unsafeActions`.
 * Reads execute normally. So a replay never mutates state, on either side.
 *
 * `outputShape` is a COARSE behavioural signature (rounded reply length + sorted
 * tools) — it tolerates LLM text wobble while still surfacing a real structural
 * change; `score` is left null (this route does not judge). The comparison verdict
 * (compareCase in replay.ts) then rests on ok / unsafeActions / shape, honestly.
 *
 * Evidence is stamped `execution_mode: 'live_langgraph'` by the route — the only
 * provenance a REQUIRED promotion-gate replay check accepts.
 *
 * Callers MUST invoke the returned `cleanup()` to tear the ephemeral assistant down.
 *
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { liveEvidenceAdapter } from './evidence/live-adapter'
import { deleteCandidateAssistant, ensureCandidateAssistant } from './langgraph-assistants'
import { getTool } from './registry/tools'
import type { ReplayOutcome, ReplayRunner } from './replay'
import { loadCandidateExec } from './shadow-live'
import type { EvidenceToolCall } from './evidence/execution-adapter'

/** Coarse, wobble-tolerant behavioural signature of one run. */
function outputShape(reply: unknown, toolsCalled: string[]): string {
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply ?? '')
  const lenBucket = Math.round(text.length / 50) * 50
  return `len:${lenBucket}|tools:${[...toolsCalled].sort().join(',')}`
}

/**
 * Build a LIVE replay runner for one version. Provisions that version's ephemeral
 * assistant once; the returned `run` executes one input through the real runtime
 * and returns a ReplayOutcome. `cleanup()` tears the assistant down.
 */
export async function makeLiveReplayRunner(
  versionId: string,
): Promise<{ run: ReplayRunner; cleanup: () => Promise<void> }> {
  const exec = await loadCandidateExec(versionId)
  const assistantId = await ensureCandidateAssistant(versionId)

  const run: ReplayRunner = async (input): Promise<ReplayOutcome> => {
    const startedAt = Date.now()
    let reply: unknown = null
    let costUsd: number | null = 0
    let ok = true
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
        userLabel: `replay ${versionId}`,
        assistantId,
        stream: false,
      })
      reply = result.reply
      costUsd = result.costUsd
      toolCalls = result.toolCalls
    } catch {
      ok = false
    }

    const toolsCalled = toolCalls.map((t) => t.toolName)
    // Unsafe = mutating tools the version attempted (blocked at confirmation, never
    // executed — same registry authority as the shadow gate).
    const unsafeActions = toolsCalled.filter((name) => getTool(name)?.mutates === true).length

    return {
      ok,
      outputShape: outputShape(reply, toolsCalled),
      score: null,
      toolsCalled,
      unsafeActions,
      latencyMs: Date.now() - startedAt,
      costUsd: costUsd ?? 0,
    }
  }

  return { run, cleanup: async () => { await deleteCandidateAssistant(versionId) } }
}
