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
 */
import { agentServerClient } from '../src/lib/agent-mission-control/langgraph-client'
import { ensureCopilotAssistant, ensureProjectAssistant } from '../src/lib/agent-mission-control/langgraph-assistants'
import { pgrest, requireBackend } from '../src/lib/agent-mission-control/postgrest'

type Row = Record<string, unknown>

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

async function reprovisionProjects(): Promise<{ recreated: number; refreshed: number }> {
  const rows = await pgrest<Row[]>('GET', 'projects?select=id,name,assistant_id&order=created_at')
  let recreated = 0
  let refreshed = 0

  for (const row of rows) {
    const id = row.id as string
    const name = (row.name as string | null) ?? id
    const priorAssistantId = row.assistant_id as string | null
    const wasLive = priorAssistantId ? await assistantExists(priorAssistantId) : false

    const assistantId = await ensureProjectAssistant({ projectId: id, name })

    if (!priorAssistantId || !wasLive) {
      recreated += 1
      console.log(
        `[project] ${name} (${id}) — assistant RECREATED: ${assistantId}` +
          (priorAssistantId && priorAssistantId !== assistantId ? ` (DB had ${priorAssistantId})` : '')
      )
    } else {
      refreshed += 1
      console.log(`[project] ${name} (${id}) — assistant already live: ${assistantId} (config refreshed)`)
    }
  }

  return { recreated, refreshed }
}

async function reprovisionCopilots(): Promise<{ recreated: number; refreshed: number }> {
  const rows = await pgrest<Row[]>('GET', 'copilots?select=id,name,assistant_id&order=name')
  let recreated = 0
  let refreshed = 0

  for (const row of rows) {
    const id = row.id as string
    const name = (row.name as string | null) ?? id
    const priorAssistantId = row.assistant_id as string | null
    const wasLive = priorAssistantId ? await assistantExists(priorAssistantId) : false

    const assistantId = await ensureCopilotAssistant({ copilotId: id })

    if (!priorAssistantId || !wasLive) {
      recreated += 1
      console.log(
        `[copilot] ${name} (${id}) — assistant RECREATED: ${assistantId}` +
          (priorAssistantId && priorAssistantId !== assistantId ? ` (DB had ${priorAssistantId})` : '')
      )
    } else {
      refreshed += 1
      console.log(`[copilot] ${name} (${id}) — assistant already live: ${assistantId} (config refreshed)`)
    }
  }

  return { recreated, refreshed }
}

async function main() {
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

  console.log('Reprovisioning project assistants…')
  const projects = await reprovisionProjects()

  console.log('Reprovisioning copilot assistants…')
  const copilots = await reprovisionCopilots()

  console.log('')
  console.log(
    `OK — projects: ${projects.recreated} recreated / ${projects.refreshed} already live · ` +
      `copilots: ${copilots.recreated} recreated / ${copilots.refreshed} already live.`
  )
}

main().catch((err) => {
  console.error('reprovisioning failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
