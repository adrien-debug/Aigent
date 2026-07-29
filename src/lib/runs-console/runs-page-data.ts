import { cookies } from 'next/headers'

import { SESSION_COOKIE, decodeSession } from '@/lib/agent-mission-control/auth'
import { getCopilots, getProjects, getRecentRunsInWindow } from '@/lib/agent-mission-control/data'
import { isDevSeedCopilot } from '@/lib/agent-mission-control/dev-seed-markers'
import { pgrestDetail } from '@/lib/agent-mission-control/postgrest'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

/**
 * Rows kept for the table feed. The 24h window itself is bounded by
 * WINDOW_MAX_ROWS below; this second cap is what the UI renders and is
 * DISCLOSED in the page ("capped at N rows"), never applied silently.
 */
const RUNS_TABLE_CAP = 200

/** Safety cap on the window read — the window is defined by time, not by N. */
const WINDOW_MAX_ROWS = 1000

/** What the shell may say about the current viewer. The admin session carries
 *  NO name or email (see auth.ts `AdminSession`), so the shell shows the role
 *  it can prove and nothing else — no invented display name. */
export interface ViewerIdentity {
  role: string | null
  authenticated: boolean
}

/** A read that failed while the page still had enough to render truthfully. */
export type DegradedSource = 'agents' | 'projects'

export interface RunsPageData {
  nowIso: string
  nowMs: number
  runs: AgentRun[]
  copilotById: Map<string, Copilot>
  agentNameById: Map<string, string>
  projectNameById: Map<string, string>
  viewer: ViewerIdentity
  /** Non-empty when a SECONDARY read failed: rows are real, labels are not all resolvable. */
  degraded: DegradedSource[]
  degradedDetail: string | null
  /**
   * How many operational runs the 24h window ACTUALLY held, before the table
   * cap. Without this the page could only ever report the size of its own
   * slice: with 640 runs in the window it would print "Runs in period 200",
   * a period total that is simply false. Metrics stay derived from the single
   * rendered array (the one-derivation-path contract); this number exists so
   * the UI can state the ratio instead of passing a cap off as a total.
   */
  windowRunCount: number
  /** True when the 24h window read hit its row cap — disclosed in the UI. */
  windowTruncated: boolean
  windowMaxRows: number
  tableRowCap: number
}

async function readViewer(): Promise<ViewerIdentity> {
  try {
    const store = await cookies()
    const session = decodeSession(store.get(SESSION_COOKIE)?.value)
    return { role: session?.role ?? null, authenticated: session !== null }
  } catch {
    // Cookie access can throw outside a request scope; an unknown viewer is
    // reported as unknown rather than assumed to be an admin.
    return { role: null, authenticated: false }
  }
}

/**
 * `/admin/runs` data-fetch. Composes EXISTING getters — same
 * non-evaluation-run contract (`getRecentRunsInWindow`) the legacy Performance
 * page uses, so "runs" means one thing across V1 and V2.
 *
 * FAIL-CLOSED, in two tiers:
 *  - the RUNS read is load-bearing: if it throws, this function throws and
 *    `admin-v2/error.tsx` renders. An unreadable backend is never flattened
 *    into an empty, healthy-looking fleet.
 *  - the AGENT/PROJECT reads are labels: if one throws, the page still renders
 *    the real runs and reports the degradation (`degraded`) so ids show up
 *    plainly instead of the screen pretending every label resolved.
 */
export async function getRunsPageData(): Promise<RunsPageData> {
  const nowMs = Date.now()
  const nowIso = new Date(nowMs).toISOString()

  const [viewer, copilotsResult, projectsResult, runsResult] = await Promise.all([
    readViewer(),
    Promise.allSettled([getCopilots()]).then((r) => r[0]!),
    Promise.allSettled([getProjects()]).then((r) => r[0]!),
    Promise.allSettled([getRecentRunsInWindow({ nowMs, maxRows: WINDOW_MAX_ROWS })]).then((r) => r[0]!),
  ])

  // Load-bearing: no runs read, no page.
  if (runsResult.status === 'rejected') throw runsResult.reason

  const degraded: DegradedSource[] = []
  const degradedDetails: string[] = []

  const copilots = copilotsResult.status === 'fulfilled' ? copilotsResult.value : []
  if (copilotsResult.status === 'rejected') {
    degraded.push('agents')
    degradedDetails.push(`agents: ${pgrestDetail(copilotsResult.reason)}`)
  }

  const projects = projectsResult.status === 'fulfilled' ? projectsResult.value : []
  if (projectsResult.status === 'rejected') {
    degraded.push('projects')
    degradedDetails.push(`projects: ${pgrestDetail(projectsResult.reason)}`)
  }

  const copilotById = new Map(copilots.map((c) => [c.id, c]))
  const agentNameById = new Map(copilots.map((c) => [c.id, c.name]))
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))

  // Dev-seed fixtures exist to render screens locally; they must not appear in
  // a console presented as the real production run stream. With the copilot
  // read degraded we cannot tell fixtures apart, so nothing is dropped — an
  // over-inclusive list with a visible warning beats a silently filtered one.
  const windowRuns = runsResult.value.filter((run) => {
    const copilot = copilotById.get(run.copilotId)
    return !copilot || !isDevSeedCopilot(copilot)
  })

  return {
    nowIso,
    nowMs,
    runs: windowRuns.slice(0, RUNS_TABLE_CAP),
    copilotById,
    agentNameById,
    projectNameById,
    viewer,
    degraded,
    degradedDetail: degradedDetails.length > 0 ? degradedDetails.join(' · ') : null,
    windowRunCount: windowRuns.length,
    windowTruncated: runsResult.value.length >= WINDOW_MAX_ROWS,
    windowMaxRows: WINDOW_MAX_ROWS,
    tableRowCap: RUNS_TABLE_CAP,
  }
}
