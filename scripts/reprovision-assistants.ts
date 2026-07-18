/**
 * Re-provision every project's and copilot's LangGraph assistant against the
 * live Agent Server.
 *
 * THE BUG this fixes: `langgraphjs dev` keeps every provisioned assistant
 * IN MEMORY ONLY. Each restart of the Agent Server wipes them all, while the
 * DB (`projects.assistant_id` / `copilots.assistant_id`) still points at the
 * now-vanished ids. A run then resolves an assistant id the Agent Server has
 * never heard of. Historically that meant a 404 got swallowed somewhere on
 * the dispatch path and the run fell back to the bare `agent_builder` graph
 * with `config: {}` — no repo tools mounted, the model hallucinates the repo
 * contents, and the run still reports `completed`. Silent failure, worst
 * case. (`resolve-run-assistant.ts` now guards against this at request time by
 * verifying liveness before every run; this script is the operational,
 * run-by-hand fix — e.g. right after restarting the Agent Server — so nobody
 * has to hit that guard's re-provision-on-the-fly path under run pressure.)
 *
 * This script is idempotent: `ensureProjectAssistant` / `ensureCopilotAssistant`
 * (see src/lib/agent-mission-control/langgraph-assistants.ts) always use a
 * DETERMINISTIC v5 UUID derived from the entity id, create with
 * `ifExists: 'do_nothing'`, and then unconditionally push an `update` with the
 * current config. So calling them again:
 *   - when the assistant is MISSING on the server → recreates it at the exact
 *     same id, with the current (possibly updated) config/behaviour.
 *   - when the assistant is ALREADY there → the create is a no-op (do_nothing)
 *     and the update just re-syncs the config to whatever the DB says now.
 * Either way nothing is duplicated and nothing breaks — safe to run any time,
 * not just after an Agent Server restart.
 *
 * Fail-closed: requires the same live env as the app (AMC_DATA_SOURCE=gpu1,
 * AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) plus a reachable Agent Server
 * (LANGGRAPH_API_URL, default http://127.0.0.1:2024, + LANGGRAPH_SERVER_SECRET
 * if the server enforces it). Missing/unreachable either one is a hard exit(1)
 * with an explicit message — this script never limps along silently.
 *
 * Run (env comes from .env.local, same as scripts/seed-amc.ts /
 * scripts/provision-agent-builder.ts). Unlike those two scripts, this one DOES
 * import 'server-only'-guarded modules (langgraph-assistants.ts,
 * langgraph-client.ts, postgrest.ts) — that marker package unconditionally
 * throws outside a bundler's `react-server` resolution condition, so tsx must
 * be told to honor that condition (exactly what Next.js's RSC bundler does)
 * via `--conditions=react-server`, which resolves 'server-only' to its no-op:
 *   node --env-file=.env.local "$(command -v npx)" -y tsx --conditions=react-server scripts/reprovision-assistants.ts
 * or, wired in package.json:
 *   npm run reprovision
 *
 * Reporting is NON-MASKING: the summary distinguishes the four mutually-exclusive
 * outcomes per row — `recreatedAfterRestart` (server was wiped, DB id already
 * correct), `driftCorrected` (DB pointed at a DIFFERENT non-null id, rewired),
 * `wasNull` (DB had no id, provisioned), and `refreshed` (already correct, config
 * re-synced) — instead of one blurry "recreated" count. Copilots whose runtime is
 * not `langgraph` are SKIPPED (no assistant is grafted onto them). Before
 * repairing, it runs `reconcileAssistants()` (read-only) and logs the observed
 * DB ↔ server divergence, so the log records reality before it is acted on.
 *
 * Modes:
 *   - default        — repair, non-blocking (exit 0 even when it fixed drift).
 *                      Safe as the prod-docker one-shot after a server restart.
 *   - --strict (or REPROVISION_STRICT=1) — still repairs, but exits 2 when the DB
 *                      had diverged (any driftCorrected or wasNull). For CI /
 *                      health checks that must fail on divergence.
 */
import { setCopilotAssistantId, setProjectAssistantId } from '../src/lib/agent-mission-control/authoring-writes'
import { agentServerClient } from '../src/lib/agent-mission-control/langgraph-client'
import { ensureCopilotAssistant, ensureProjectAssistant } from '../src/lib/agent-mission-control/langgraph-assistants'
import { pgrest, requireBackend } from '../src/lib/agent-mission-control/postgrest'
import { reconcileAssistants } from '../src/lib/agent-mission-control/reconcile-assistants'
import type { AgentRuntime } from '../src/lib/agent-mission-control/types'

type Row = Record<string, unknown>

/**
 * The three DISTINCT things a re-provision can do to a single row, kept apart so
 * the report never masks a drift or a NULL behind a generic "recreated" count
 * (the bug: `reprovision` used to lump recreated/refreshed/drift/null together,
 * hiding that the DB had been silently pointing at a stale or non-canonical id).
 *
 *  - `recreatedAfterRestart` — the assistant was MISSING on the server (server
 *    restart wiped it, or it never existed) and got recreated at its id. The DB
 *    id was already correct (or null → see `wasNull`); no data was rewired, the
 *    server was just re-seeded. Benign, expected after a restart.
 *  - `driftCorrected`        — the DB recorded a NON-NULL assistant_id that
 *    DIFFERED from the id we (re)provision to. The row was wired to the wrong
 *    assistant and we rewrote it. This is real DB drift — never silent.
 *  - `wasNull`               — the DB recorded NO assistant_id at all; we created
 *    one and wrote it back. The row was unprovisioned. Also never silent.
 *
 * `driftCorrected` and `wasNull` are the two states `--strict` treats as a
 * non-zero exit: both mean the DB was NOT already in the desired state.
 */
interface ReprovisionTally {
  /** Assistant was absent server-side and recreated (DB id already matched or null-handled separately). */
  recreatedAfterRestart: number
  /** DB had a non-null id that differed from the provisioned id — rewired. */
  driftCorrected: number
  /** DB had no id at all — provisioned and written back. */
  wasNull: number
  /** Assistant already live AND DB id already correct — pure config re-sync. */
  refreshed: number
  /** Rows skipped because their runtime is not `langgraph` (no assistant to graft). */
  skippedNonLanggraph: number
}

function emptyTally(): ReprovisionTally {
  return { recreatedAfterRestart: 0, driftCorrected: 0, wasNull: 0, refreshed: 0, skippedNonLanggraph: 0 }
}

/** True when an error thrown by the LangGraph SDK is an HTTP 404 (assistant not found). */
function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'status' in err && (err as { status?: unknown }).status === 404
}

/** Does this assistant id currently exist on the Agent Server? */
async function assistantExists(assistantId: string): Promise<boolean> {
  try {
    await agentServerClient().assistants.get(assistantId)
    return true
  } catch (err) {
    if (isNotFound(err)) return false
    throw err
  }
}

async function reprovisionProjects(): Promise<ReprovisionTally> {
  const rows = await pgrest<Row[]>('GET', 'projects?select=id,name,assistant_id&order=created_at')
  const tally = emptyTally()

  for (const row of rows) {
    const id = row.id as string
    const name = (row.name as string | null) ?? id
    const priorAssistantId = row.assistant_id as string | null
    const wasLive = priorAssistantId ? await assistantExists(priorAssistantId) : false

    const assistantId = await ensureProjectAssistant({ projectId: id, name })

    // Persist the id when the DB doesn't have it (or has a stale one). Without
    // this the assistant exists on the server but the row still says NULL, so
    // the run-time cascade can't find it and silently falls back to the bare
    // graph (no tools) — exactly the bug this script is meant to fix.
    const idChanged = priorAssistantId !== assistantId
    if (idChanged) {
      await setProjectAssistantId(id, assistantId)
    }

    // Classify the ONE thing that actually happened to this row. The four
    // outcomes are mutually exclusive per row (unlike the reconcile classes),
    // so the report can never hide a drift or a null behind "recreated".
    if (!priorAssistantId) {
      tally.wasNull += 1
      console.log(`[project] ${name} (${id}) — WAS-NULL, provisioned: ${assistantId}`)
    } else if (priorAssistantId !== assistantId) {
      tally.driftCorrected += 1
      console.log(`[project] ${name} (${id}) — DRIFT CORRECTED: ${priorAssistantId} → ${assistantId}`)
    } else if (!wasLive) {
      tally.recreatedAfterRestart += 1
      console.log(`[project] ${name} (${id}) — RECREATED after restart (DB id was already correct): ${assistantId}`)
    } else {
      tally.refreshed += 1
      console.log(`[project] ${name} (${id}) — already live: ${assistantId} (config refreshed)`)
    }
  }

  return tally
}

async function reprovisionCopilots(): Promise<ReprovisionTally> {
  const rows = await pgrest<Row[]>('GET', 'copilots?select=id,name,assistant_id,runtime&order=name')
  const tally = emptyTally()

  for (const row of rows) {
    const id = row.id as string
    const name = (row.name as string | null) ?? id
    const priorAssistantId = row.assistant_id as string | null
    const runtime = ((row.runtime as string | null) ?? 'custom') as AgentRuntime

    // Skip copilots that do NOT run on LangGraph. Only the langgraph runtime
    // dispatches through a provisioned assistant; grafting one onto an
    // openai-assistants / gemini / custom copilot writes dead, misleading
    // metadata (it lies about the runtime and is never used on the direct
    // model-router path). Reconciliation flags these as `inertPhantom`; here we
    // simply leave them alone. We do NOT null out an existing id — that's a
    // separate, explicit cleanup (rebrand scripts own it), not this repairer's job.
    if (runtime !== 'langgraph') {
      tally.skippedNonLanggraph += 1
      console.log(
        `[copilot] ${name} (${id}) — SKIPPED (runtime=${runtime}, not langgraph)` +
          (priorAssistantId ? ` — inert assistant_id ${priorAssistantId} left untouched` : '')
      )
      continue
    }

    const wasLive = priorAssistantId ? await assistantExists(priorAssistantId) : false

    const assistantId = await ensureCopilotAssistant({ copilotId: id })

    // Same as projects: create the assistant AND write its id back, otherwise
    // the row stays NULL and the run silently degrades to the bare graph.
    const idChanged = priorAssistantId !== assistantId
    if (idChanged) {
      await setCopilotAssistantId(id, assistantId)
    }

    // Classify the ONE mutually-exclusive outcome for this row.
    if (!priorAssistantId) {
      tally.wasNull += 1
      console.log(`[copilot] ${name} (${id}) — WAS-NULL, provisioned: ${assistantId}`)
    } else if (priorAssistantId !== assistantId) {
      tally.driftCorrected += 1
      console.log(`[copilot] ${name} (${id}) — DRIFT CORRECTED: ${priorAssistantId} → ${assistantId}`)
    } else if (!wasLive) {
      tally.recreatedAfterRestart += 1
      console.log(`[copilot] ${name} (${id}) — RECREATED after restart (DB id was already correct): ${assistantId}`)
    } else {
      tally.refreshed += 1
      console.log(`[copilot] ${name} (${id}) — already live: ${assistantId} (config refreshed)`)
    }
  }

  return tally
}

/**
 * `--strict` (flag) or `REPROVISION_STRICT=1` (env) turns the repairer into a
 * DETECTOR: it still repairs, but exits non-zero (2) when the DB was NOT already
 * in the desired state (any `driftCorrected` or `wasNull`). Use it in CI / a
 * health check that must FAIL when reality diverged from the DB. The default
 * (no flag) stays non-blocking so the prod docker one-shot after a server
 * restart never fails just because it did its job.
 */
function isStrict(): boolean {
  return process.argv.slice(2).includes('--strict') || process.env.REPROVISION_STRICT === '1'
}

/** Log a reconcile report as the pre-repair OBSERVED state (read-only, never acts). */
function logReconcileReport(report: Awaited<ReturnType<typeof reconcileAssistants>>): void {
  console.log(
    'Observed state (reconcile, read-only): ' +
      `${report.stale.length} stale · ${report.orphan.length} orphan · ` +
      `${report.driftV5.length} driftV5 · ${report.inertPhantom.length} inertPhantom.`
  )
  for (const s of report.stale) {
    console.log(`  [stale] copilot ${s.name ?? s.copilotId} (${s.copilotId}) → DB id ${s.assistantId} absent server-side`)
  }
  for (const d of report.driftV5) {
    console.log(`  [driftV5] copilot ${d.name ?? d.copilotId} (${d.copilotId}) → ${d.assistantId} ≠ canonical ${d.expectedAssistantId}`)
  }
  for (const p of report.inertPhantom) {
    console.log(`  [inertPhantom] copilot ${p.name ?? p.copilotId} (${p.copilotId}) runtime=${p.runtime} still carries ${p.assistantId}`)
  }
  for (const o of report.orphan) {
    console.log(`  [orphan] server assistant ${o.name ?? o.assistantId} (${o.assistantId}) claimed by no DB row`)
  }
}

async function main() {
  const strict = isStrict()

  // Fail-closed on the DB perimeter — same contract as the app.
  requireBackend()

  // Fail-closed on the Agent Server: a single cheap call (search, empty
  // filter) proves the server is reachable and auth (x-agent-key) is correct
  // before we touch anything else. Any failure here means "nothing was
  // reprovisioned" rather than a half-run.
  try {
    await agentServerClient().assistants.search({ limit: 1 })
  } catch (err) {
    console.error(
      'Agent Server unreachable or rejecting auth ' +
        `(checked ${process.env.LANGGRAPH_API_URL || 'http://127.0.0.1:2024'}). ` +
        'Start it with `npm run langgraph` (or `npm run dev`) and/or set LANGGRAPH_SERVER_SECRET. ' +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`
    )
    process.exit(1)
  }

  // BEFORE any repair: log the observed DB ↔ server divergence (B2, read-only).
  // This is the ground truth the repair then acts on — recording it first means
  // the run's log always states what reality looked like, independent of what we
  // did about it. A reconcile failure is not fatal to the repair (it's
  // diagnostic), so we degrade to a warning and continue repairing.
  console.log('Reconciling observed DB ↔ Agent Server state (read-only)…')
  try {
    logReconcileReport(await reconcileAssistants())
  } catch (err) {
    console.warn(
      `Reconcile diagnostic failed (non-fatal, continuing with repair): ${err instanceof Error ? err.message : String(err)}`
    )
  }
  console.log('')

  console.log('Reprovisioning project assistants…')
  const projects = await reprovisionProjects()

  console.log('Reprovisioning copilot assistants…')
  const copilots = await reprovisionCopilots()

  const driftCorrected = projects.driftCorrected + copilots.driftCorrected
  const wasNull = projects.wasNull + copilots.wasNull

  console.log('')
  console.log(
    `OK — projects: ${projects.recreatedAfterRestart} recreated / ${projects.driftCorrected} drift-corrected / ` +
      `${projects.wasNull} was-null / ${projects.refreshed} already live · ` +
      `copilots: ${copilots.recreatedAfterRestart} recreated / ${copilots.driftCorrected} drift-corrected / ` +
      `${copilots.wasNull} was-null / ${copilots.refreshed} already live / ` +
      `${copilots.skippedNonLanggraph} skipped (non-langgraph).`
  )

  // In strict mode, a DB that was NOT already in the desired state is a failure:
  // drift-corrected (DB pointed at the wrong id) or was-null (DB was
  // unprovisioned) both mean reality had diverged. Recreated-after-restart is
  // NOT a strict failure — it's the expected, benign consequence of an Agent
  // Server restart with a correct DB. The repair already ran; strict only
  // changes the exit code so a caller can gate on divergence.
  if (strict && (driftCorrected > 0 || wasNull > 0)) {
    console.error(
      `STRICT: DB had diverged — ${driftCorrected} drift-corrected, ${wasNull} was-null. ` +
        'The rows were repaired, but strict mode exits non-zero on any divergence.'
    )
    process.exit(2)
  }
}

main().catch((err) => {
  console.error('reprovisioning failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
