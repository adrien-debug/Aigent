/**
 * AIGENT-FACTORY-READY-001 — LIVE (real-LangGraph) replay execution (server only).
 *
 * The REAL, non-fixture replay runners. A replay compares a REFERENCE version
 * (production) against a CANDIDATE version over the same inputs. Each side is run
 * through the ACTUAL LangGraph runtime via that version's ephemeral assistant
 * (`ensureCandidateAssistant`) using the shared `runVersionInputLive` primitive —
 * no fixture, no alternate execution path.
 *
 * WRITE-SAFETY (same guarantee as live shadow, see shadow-live.ts): the run never
 * confirms a tool, so a mutating tool interrupts at the graph's approval
 * checkpoint (never executes); it is counted in `unsafeActions`. Reads execute
 * normally. So a replay never mutates state, on either side.
 *
 * `outputShape` is a COARSE behavioural signature (rounded reply length + sorted
 * tools) — it tolerates LLM text wobble while still surfacing a real structural
 * change; `score` is left null (this route does not judge). The comparison verdict
 * (compareCase in replay.ts) then rests on ok / unsafeActions / shape, honestly.
 *
 * Evidence is stamped `execution_mode: 'live_langgraph'` by the route — the only
 * provenance a REQUIRED promotion-gate replay check accepts. Same runtime
 * precondition as shadow-live.ts (dev-stack launch for local endpoint resolution).
 *
 * Callers MUST invoke the returned `cleanup()` to tear the ephemeral assistant down.
 * Never import from a client component (reads the service-role key).
 */
import 'server-only'

import { deleteCandidateAssistant, ensureCandidateAssistant } from './langgraph-assistants'
import { getTool } from './registry/tools'
import type { ReplayOutcome, ReplayRunner } from './replay'
import { loadCandidateExec, runVersionInputLive } from './shadow-live'

/** Coarse, wobble-tolerant behavioural signature of one run. */
function outputShape(reply: unknown, toolsCalled: string[]): string {
  const text = typeof reply === 'string' ? reply : JSON.stringify(reply ?? '')
  const lenBucket = Math.round(text.length / 50) * 50
  return `len:${lenBucket}|tools:${toolsCalled.toSorted((a, b) => a.localeCompare(b)).join(',')}`
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
    const r = await runVersionInputLive(exec, assistantId, versionId, input, `replay ${versionId}`)
    if (r.error !== null) {
      throw new Error(`replay runtime unavailable: ${r.error}`)
    }
    const toolsCalled = r.toolCalls.map((t) => t.toolName)
    // Unsafe = mutating tools the version attempted (blocked at the confirmation
    // checkpoint, never executed — same registry authority as the shadow gate).
    const unsafeActions = toolsCalled.filter((name) => getTool(name)?.mutates === true).length

    return {
      ok: r.error === null,
      outputShape: outputShape(r.reply, toolsCalled),
      score: null,
      toolsCalled,
      unsafeActions,
      latencyMs: r.latencyMs,
      costUsd: r.costUsd,
    }
  }

  return { run, cleanup: async () => { await deleteCandidateAssistant(versionId) } }
}
