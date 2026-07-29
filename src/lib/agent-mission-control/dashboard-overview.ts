/**
 * Agent Mission Control — Dashboard overview (pure + server collector).
 *
 * Aggregates delivery-centric signals for the Agent Delivery Command Center.
 * Read-only, fail-soft: missing tables never crash the dashboard.
 */
import 'server-only'

import { getAvailableAgents, type AvailableAgent } from './available-agents'
import type { DeliveryEvent } from './delivery-events-store'
import { getCopilots, getProjects, getRecentRunsInWindow } from './data'
// The measurement rule and its rollup, shared VERBATIM with
// `src/components/console/projects-screen.tsx`. They live in their own neutral
// module because this one opens with `import 'server-only'` and a component
// cannot take a value from it — see health-measure.ts for the full reason.
import { sumMeasuredHealth } from './health-measure'
import type { MissionReport } from './mission-orchestrator'
import { pgrest } from './postgrest'
import { isExecutable } from './runtime-catalogue'
import { parseSandboxReport, type TargetRepoSandboxReport } from './target-repo-sandbox'
import type { AgentRun, Copilot, Project } from './types'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A 24h cost figure AND how much of the window it actually covers.
 *
 * `AgentRun.costUsd` is `number | null`, and `null` there means "the cost could
 * not be MEASURED" (types.ts: e.g. a LangGraph run with no usage payload) — it
 * does NOT mean the run was free. So a plain sum over a window that contains
 * unmeasured runs is a LOWER BOUND, and printing it as "the cost" is a claim
 * nobody proved. The denominator travels WITH the number so the UI can state
 * what the figure covers instead of implying it covers everything.
 *
 * Same idiom the agent detail page already ships (`AgentMetrics.cost24hUsd` +
 * `runsWithoutCost`, agent-detail.ts) — one house rule, not a second one.
 */
export type Cost24hCoverage = {
  /** Sum over the runs whose cost WAS measurable. A lower bound whenever
   *  `measuredRuns < totalRuns`; the exact total when they are equal. */
  usd: number
  /** Runs in the window that carried a measurable cost — the figure's support. */
  measuredRuns: number
  /** Runs in the window, measured or not — the denominator to disclose. */
  totalRuns: number
}

export type DashboardKpis = {
  productionAgents: number | null
  readyForManualTest: number | null
  sandboxPassRate: number | null
  avgRepoFit: number | null
  blockedDeliveries: number | null
  /** Agents the runtime would actually accept a run for right now
   * (isExecutable). Total agent count travels alongside for "N / total"
   * display. Null (both) when getAvailableAgents() failed — UNAVAILABLE,
   * never 0. */
  executableNow: number | null
  executableTotal: number | null
  /**
   * Count of operational runs with started_at in the shared 24h window.
   *
   * `0` is a MEASUREMENT — the window was read and held nothing. Null means the
   * run read FAILED (`windowRuns === null`): a failed read is not zero runs, and
   * rendering it as 0 paints a calm, healthy-looking fleet over a dead backend.
   * See the discriminator note on `DashboardOverview.windowRuns`.
   */
  runs24h: number | null
  /**
   * Completed / (completed + failed) over TERMINAL runs in the window,
   * expressed as a WHOLE PERCENTAGE (0..100), already rounded — NOT a 0..1
   * ratio. The distinction is not cosmetic: a consumer that assumed a ratio
   * and multiplied by 100 rendered "10000%" on the dashboard (caught in P004).
   *
   * Null for TWO different reasons, both honest, both rendered "Indisponible":
   * zero terminal runs in a window that WAS read (NOT_APPLICABLE), or the run
   * read failed (UNREAD). Never 0. Tell them apart via `dataWarnings` — see
   * `DashboardOverview.windowRuns`.
   */
  success24h: number | null
  /**
   * Cost over the window's runs, WITH its coverage (see `Cost24hCoverage`) —
   * not a bare number, because a bare number would keep implying it covers
   * every run in the window.
   *
   * Null for THREE honest reasons, all rendered "Indisponible", never "$0.00":
   * the run read failed, the window was read and held no run at all, or the
   * window held runs and NOT ONE of them carried a measurable cost. Same
   * `dataWarnings` discriminator as `success24h` for the first case.
   */
  cost24h: Cost24hCoverage | null
  /** Length of the action queue (overview.actionItems). */
  needsAction: number
}

export type ProjectOverviewItem = {
  id: string
  name: string
  imageUrl: string | null
  logoUrl: string | null
  repoFullName: string | null
  platform: Project['platform']
  copilotCount: number
  activeCount: number
  /**
   * Runs in the last 24h, summed over the team members that actually PROVED the
   * metric (see `isMeasuredHealth` / `sumMeasuredHealth`, `./health-measure`).
   *  · `0`     — measured: either the proven members all sat at zero, or the
   *              project has no copilot at all (no agent, no run to have made).
   *  · `n > 0` — measured.
   *  · `null`  — NOT MEASURABLE: the project has copilots and not one of them
   *              proved a run count. Renders "Indisponible", never 0.
   */
  runsLast24h: number | null
  /**
   * Cost in the last 24h, summed over the team members that actually PROVED the
   * metric — the SAME rule, the SAME function (`sumMeasuredHealth`) and the SAME
   * three states as `runsLast24h` above, so the two fields cannot behave
   * differently.
   *  · `0`     — measured: either the proven members all cost nothing, or the
   *              project has no copilot at all (no agent, no cost to incur).
   *  · `n > 0` — measured.
   *  · `null`  — NOT MEASURABLE: the project has copilots and not one of them
   *              proved a cost. Renders "Indisponible" — never "$0.00", never
   *              an empty gauge, never a zero bar.
   *
   * It used to be `number` and summed `copilot.health.costLast24hUsd` across the
   * WHOLE team, so an unproven cost normalised to 0 and rendered as a confident
   * measured "$0.00". That is the defect this type closes.
   */
  costLast24hUsd: number | null
  /** Mean test pass rate (0..1) across copilots with run-backed health, null when no evidence. */
  passRate: number | null
}

export type ActionItemKind =
  | 'ready_manual'
  | 'sandbox_failed'
  | 'release_gate_red'
  | 'pr_open'
  | 'mission_blocked'
  | 'data_unavailable'

export type ActionItem = {
  id: string
  kind: ActionItemKind
  title: string
  meta: string
  status: string
  href: string
  buttonLabel: string
  priority: number
}

export type DashboardOverview = {
  kpis: DashboardKpis
  projects: ProjectOverviewItem[]
  actionItems: ActionItem[]
  dataWarnings: string[]
  /**
   * The SAME 24h-window runs used to derive runs24h/success24h/cost24h, so the
   * page can reuse them for the activity/status/cost charts instead of a second
   * separate load — one shared window instant across the whole dashboard.
   *
   * THREE STATES, ALL DISTINGUISHABLE:
   *  · `[]`        — the read SUCCEEDED and the window is empty. A measured
   *                  emptiness: runs24h is 0, no warning is pushed.
   *  · `[...]`     — the read succeeded with runs. Measured values.
   *  · `null`      — the read FAILED. runs24h/success24h/cost24h are all null
   *                  and `dataWarnings` carries RUNS_READ_FAILED_WARNING. Charts
   *                  must render "Indisponible", NOT an empty axis or a flat
   *                  zero curve — an unread window is not a quiet one.
   *
   * DISCRIMINATOR for the null metrics: `dataWarnings`. A null KPI with NO
   * run-history warning means measured-but-nothing-to-measure; a null KPI WITH
   * that warning means unread. The data layer never conflates the two.
   */
  windowRuns: AgentRun[] | null
}

type SandboxSnapshot = {
  copilotId: string
  status: TargetRepoSandboxReport['status']
  sandboxFitScore: number | null
  repoFitScore: number | null
  repo: string | null
  createdAt: string
}

type ScorecardSnapshot = {
  score: number
  level: string
  blockers: string[]
  repoFitScore: number | null
  releaseGateRed: boolean
}

type MissionRunSnapshot = {
  id: string
  projectId: string
  objective: string
  status: string
  decision: string | null
  repo: string | null
  updatedAt: string
  report: MissionReport | null
}

// ---------------------------------------------------------------------------
// Pure — KPIs
// ---------------------------------------------------------------------------

export function computeProductionAgents(
  copilots: Pick<Copilot, 'productionVersionId' | 'displayStatus'>[]
): number {
  return copilots.filter((c) => Boolean(c.productionVersionId) || c.displayStatus === 'production').length
}

export function computeReadyForManualTest(events: Pick<DeliveryEvent, 'status'>[]): number {
  return events.filter((e) => e.status === 'ready_for_manual_test').length
}

export function computeSandboxPassRate(reports: Pick<SandboxSnapshot, 'status'>[]): number | null {
  if (reports.length === 0) return null
  const passed = reports.filter((r) => r.status === 'passed').length
  return Math.round((passed / reports.length) * 100)
}

export function computeAvgRepoFit(scores: number[]): number | null {
  if (scores.length === 0) return null
  return Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
}

export function isBlockedDelivery(input: {
  deliveryStatus: string | null
  sandboxStatus: string | null
  scorecard: ScorecardSnapshot | null
  missionStatus: string | null
}): boolean {
  if (input.sandboxStatus === 'failed') return true
  if (input.missionStatus === 'blocked') return true
  if (input.deliveryStatus === 'execute_failed' || input.deliveryStatus === 'blocked') return true
  if (input.scorecard?.releaseGateRed) return true
  if (input.scorecard && input.scorecard.level === 'not_ready' && input.scorecard.blockers.length > 0) return true
  return false
}

export function computeBlockedDeliveries(
  copilotIds: string[],
  latestDeliveryByCopilot: Map<string, DeliveryEvent>,
  latestSandboxByCopilot: Map<string, SandboxSnapshot>,
  scorecards: Map<string, ScorecardSnapshot>,
  missionRuns: MissionRunSnapshot[]
): number {
  let count = 0
  const seen = new Set<string>()
  for (const id of copilotIds) {
    if (seen.has(id)) continue
    seen.add(id)
    const blocked = isBlockedDelivery({
      deliveryStatus: latestDeliveryByCopilot.get(id)?.status ?? null,
      sandboxStatus: latestSandboxByCopilot.get(id)?.status ?? null,
      scorecard: scorecards.get(id) ?? null,
      missionStatus: null,
    })
    if (blocked) count += 1
  }
  count += missionRuns.filter((m) => m.status === 'blocked' || m.decision === 'blocked').length
  return count
}

/** Runs classified as terminal for a success ratio — mirrors the classification
 * RunStatusBreakdownChart already renders (completed/failed are the only two
 * terminal-success statuses; blocked/needs-confirmation/running are excluded
 * from the ratio the same way they get their own bars, not folded into
 * "failed").
 *
 * `null` window = the run read FAILED → null, and it never even counts. Passing
 * an array keeps the previous behaviour byte for byte. */
export function computeSuccess24h(windowRuns: Pick<AgentRun, 'status'>[] | null): number | null {
  if (windowRuns === null) return null
  const completed = windowRuns.filter((r) => r.status === 'completed').length
  const failed = windowRuns.filter((r) => r.status === 'failed').length
  const terminal = completed + failed
  if (terminal === 0) return null
  return Math.round((completed / terminal) * 100)
}

/**
 * Cost over the window, WITH the coverage of that cost.
 *
 * WHY THE SHAPE CHANGED — this used to be `reduce((s, r) => s + (r.costUsd ?? 0))`.
 * That `?? 0` folded a run whose cost was NOT MEASURABLE into the total as if it
 * had been free. `AgentRun.costUsd === null` means the runner could not measure
 * the cost (types.ts — e.g. LangGraph with no usage), so a sum over a set that
 * contains unmeasured members is a LOWER BOUND, and returning it as a bare
 * `number` presented it as THE cost. Two runs at $1.50 and "unknown" reported
 * "$1.50" — a figure nobody proved.
 *
 * CHOSEN: (b) partial-with-provenance, NOT (a) strict-null. Strict would be
 * honest too, but LangGraph is mandatory for every agent in this fleet
 * (AGENTS.md) and its runs commonly carry a null cost, so (a) would make this
 * KPI null nearly always — that is a true statement said so often it stops being
 * read, and it would also throw away the dollars that WERE measured. (b) keeps
 * the measured dollars and hands the UI the denominator, which is exactly what
 * `agent-detail.ts` already does for the per-agent card (`cost24hUsd` +
 * `runsWithoutCost`). One house rule for "partial measurement", not two.
 *
 * NULL — three absences, one rendering ("Indisponible"), never 0:
 *  · `windowRuns === null` — the run read FAILED. Discriminated by
 *    `dataWarnings` carrying RUNS_READ_FAILED_WARNING.
 *  · empty window — nothing to sum. UNCHANGED, documented and unit-tested
 *    behaviour: an empty sum is "nothing measured", not a measured zero cost.
 *  · window read, runs present, NOT ONE carried a measurable cost. New, and the
 *    reason this returns a record instead of `{usd: 0, measuredRuns: 0}`: a
 *    zero with zero support must be structurally impossible to render as
 *    "$0.00". Same call `buildProjectOverview` makes for a team that proved
 *    nothing.
 *
 * A genuine measured zero still comes back as a real zero: runs whose costUsd IS
 * `0` count as measured and produce `{ usd: 0, measuredRuns: n, … }`.
 */
export function computeCost24h(windowRuns: Pick<AgentRun, 'costUsd'>[] | null): Cost24hCoverage | null {
  if (windowRuns === null) return null
  if (windowRuns.length === 0) return null
  // A type predicate, not a cast: the narrowing IS the measurement rule here
  // (finite number = measured; null/undefined/NaN = not measured), and writing
  // it once keeps the reduce below from having to re-assert it.
  const measured = windowRuns
    .map((run) => run.costUsd)
    .filter((usd): usd is number => Number.isFinite(usd))
  if (measured.length === 0) return null
  return {
    usd: measured.reduce((sum, usd) => sum + usd, 0),
    measuredRuns: measured.length,
    totalRuns: windowRuns.length,
  }
}

// ---------------------------------------------------------------------------
// Pure — project overview rollup
// ---------------------------------------------------------------------------

/** Ordering key ONLY — never rendered. An unmeasured run count sorts BELOW a
 *  measured zero (-1), so "nobody measured" never outranks a proven quiet
 *  project; it must not be read anywhere as a zero measurement. */
function runsOrderKey(item: Pick<ProjectOverviewItem, 'runsLast24h'>): number {
  return item.runsLast24h === null ? -1 : item.runsLast24h
}

export function buildProjectOverview(projects: Project[], copilots: Copilot[]): ProjectOverviewItem[] {
  // The team per project, assembled once. A copilot with no `projectId` is on
  // the validation bench and belongs to no team — it must not land in any
  // project's total.
  const teams = new Map<string, Copilot[]>()
  for (const copilot of copilots) {
    if (copilot.projectId === null) continue
    const team = teams.get(copilot.projectId)
    if (team === undefined) teams.set(copilot.projectId, [copilot])
    else team.push(copilot)
  }

  return projects
    .map((project) => {
      // A project no copilot points at has an EMPTY team, not a missing one —
      // and an empty team is a measured 0 (no agent, no run to have made, no
      // cost to have incurred), which is exactly what `sumMeasuredHealth`
      // returns for `[]`.
      const team = teams.get(project.id) ?? []

      // ONE rule, ONE rollup, ONE module (`./health-measure`) — the SAME
      // function `/admin/projects` calls, so the two screens cannot reach
      // different verdicts about the same project. Its three states ARE the
      // three states of these two fields, applied IDENTICALLY to runs and to
      // cost with no room for them to disagree:
      //  · empty team              → a measured 0.
      //  · team, nothing proven    → null → NOT MEASURABLE → "Indisponible".
      //  · team with proven members→ the proven sum, a genuine 0 included.
      // Placeholders never enter the sum: `health.runsLast24h` /
      // `health.costLast24hUsd` are normalisation fillers whenever
      // `healthUnavailableFields` names them, and adding a filler to a total is
      // what turned "nobody measured" into a confident "$0.00".
      const runs = sumMeasuredHealth(team, 'runsLast24h')
      const cost = sumMeasuredHealth(team, 'costLast24hUsd')

      // testPassRate deliberately does NOT go through that gate: the mean here
      // has always been over the members whose rate the data layer proved, and
      // `healthEvidence` is 'runs' for a benchmark-only copilot whose
      // testPassRate is a placeholder 0 that would drag the mean down. Kept
      // verbatim — this consolidation moves the run/cost rule, it does not
      // re-litigate pass rate.
      const passRates = team
        .filter((c) => c.healthUnavailableFields && !c.healthUnavailableFields.includes('testPassRate'))
        .map((c) => c.health.testPassRate)
      const passRate =
        passRates.length > 0 ? passRates.reduce((s, n) => s + n, 0) / passRates.length : null

      return {
        id: project.id,
        name: project.name,
        imageUrl: project.imageUrl ?? null,
        logoUrl: project.logoUrl ?? null,
        repoFullName: project.repoFullName ?? null,
        platform: project.platform,
        // Structural counts, not measurements: the team really does hold this
        // many rows, so 0 here is a fact and needs no coverage record.
        copilotCount: team.length,
        activeCount: team.filter((c) => c.status === 'active').length,
        runsLast24h: runs === null ? null : runs.value,
        costLast24hUsd: cost === null ? null : cost.value,
        passRate,
      }
    })
    .sort((a, b) => {
      const aSignal = a.passRate !== null || (a.runsLast24h !== null && a.runsLast24h > 0) ? 1 : 0
      const bSignal = b.passRate !== null || (b.runsLast24h !== null && b.runsLast24h > 0) ? 1 : 0
      return bSignal - aSignal || runsOrderKey(b) - runsOrderKey(a) || a.name.localeCompare(b.name)
    })
}

// ---------------------------------------------------------------------------
// Pure — action items
// ---------------------------------------------------------------------------

const ACTION_PRIORITY: Record<ActionItemKind, number> = {
  ready_manual: 1,
  sandbox_failed: 2,
  release_gate_red: 3,
  pr_open: 4,
  mission_blocked: 5,
  data_unavailable: 6,
}

export function buildActionItems(input: {
  copilotsById: Map<string, Copilot>
  projectsById: Map<string, Project>
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  scorecards: Map<string, ScorecardSnapshot>
  missionRuns: MissionRunSnapshot[]
  dataWarnings: string[]
  limit?: number
}): ActionItem[] {
  const items: ActionItem[] = []

  for (const [copilotId, evt] of input.latestDeliveryByCopilot) {
    const copilot = input.copilotsById.get(copilotId)
    if (!copilot) continue
    const project = copilot.projectId ? input.projectsById.get(copilot.projectId) : undefined
    const meta = `${copilot.name} · ${evt.targetRepo || project?.repoFullName || '—'}`

    if (evt.status === 'ready_for_manual_test') {
      items.push({
        id: `action_ready_${copilotId}`,
        kind: 'ready_manual',
        title: 'Ready for manual test',
        meta,
        status: evt.status,
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'Review',
        priority: ACTION_PRIORITY.ready_manual,
      })
    }

    const sandbox = input.latestSandboxByCopilot.get(copilotId)
    if (sandbox?.status === 'failed') {
      items.push({
        id: `action_sandbox_${copilotId}`,
        kind: 'sandbox_failed',
        title: 'Sandbox failed',
        meta,
        status: 'failed',
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'View Sandbox',
        priority: ACTION_PRIORITY.sandbox_failed,
      })
    }

    const card = input.scorecards.get(copilotId)
    if (card?.releaseGateRed) {
      items.push({
        id: `action_gate_${copilotId}`,
        kind: 'release_gate_red',
        title: 'Release gate red',
        meta,
        status: 'blocked',
        href: `/admin/agents/${copilotId}`,
        buttonLabel: 'View Scorecard',
        priority: ACTION_PRIORITY.release_gate_red,
      })
    }

    if (evt.prUrl && evt.status !== 'merged_validated' && evt.status !== 'completed') {
      items.push({
        id: `action_pr_${copilotId}`,
        kind: 'pr_open',
        title: evt.prNumber ? `PR #${evt.prNumber} awaiting review` : 'PR open awaiting review',
        meta,
        status: 'open',
        href: evt.prUrl,
        buttonLabel: 'Open PR',
        priority: ACTION_PRIORITY.pr_open,
      })
    }
  }

  const seenBlockedProjects = new Set<string>()
  for (const mission of input.missionRuns) {
    if (mission.status !== 'blocked' && mission.decision !== 'blocked') continue
    // missionRuns arrive newest-first — keep only the latest blocked row per project.
    if (seenBlockedProjects.has(mission.projectId)) continue
    seenBlockedProjects.add(mission.projectId)
    const project = input.projectsById.get(mission.projectId)
    items.push({
      id: `action_mission_${mission.id}`,
      kind: 'mission_blocked',
      title: 'Mission blocked',
      meta: `${project?.name ?? mission.projectId} · ${mission.repo ?? '—'}`,
      status: mission.status,
      href: project ? `/admin/projects/${project.id}` : '/admin',
      buttonLabel: 'View Mission',
      priority: ACTION_PRIORITY.mission_blocked,
    })
  }

  // System-level ingest warnings belong in DashboardDataWarnings — not the
  // operator action queue (there is no button that fixes a missing table).
  return items
    .sort((a, b) => a.priority - b.priority)
    .slice(0, input.limit ?? 6)
}

// ---------------------------------------------------------------------------
// Pure — assemble overview from snapshots
// ---------------------------------------------------------------------------

export function assembleDashboardOverview(input: {
  copilots: Copilot[]
  projects: Project[]
  latestDeliveryByCopilot: Map<string, DeliveryEvent>
  latestSandboxByCopilot: Map<string, SandboxSnapshot>
  scorecards: Map<string, ScorecardSnapshot>
  missionRuns: MissionRunSnapshot[]
  dataWarnings: string[]
  /** Null when getAvailableAgents() failed — kept distinct from an empty
   * (proven-zero) array so executableNow can render `Indisponible` rather than
   * "0". (It says `Indisponible`, not "—": `overview-screen.tsx` renders
   * `unavailableFigure` there. This comment said "—" long after the screen had
   * stopped agreeing with it.) */
  availableAgents: AvailableAgent[] | null
  /** Null when getRecentRunsInWindow() failed — kept distinct from an empty
   * (read-and-nothing-there) array exactly like `availableAgents`, so runs24h
   * can render "Indisponible" rather than a reassuring 0. */
  windowRuns: AgentRun[] | null
}): DashboardOverview {
  const copilotsById = new Map(input.copilots.map((c) => [c.id, c]))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))
  const copilotIds = input.copilots.map((c) => c.id)

  const latestDeliveries = [...input.latestDeliveryByCopilot.values()]
  const sandboxSnapshots = [...input.latestSandboxByCopilot.values()]
  const repoFitScores = [
    ...sandboxSnapshots.map((s) => s.repoFitScore).filter((n): n is number => n != null),
    ...[...input.scorecards.values()].map((s) => s.repoFitScore).filter((n): n is number => n != null),
  ]

  const actionItems = buildActionItems({
    copilotsById,
    projectsById,
    latestDeliveryByCopilot: input.latestDeliveryByCopilot,
    latestSandboxByCopilot: input.latestSandboxByCopilot,
    scorecards: input.scorecards,
    missionRuns: input.missionRuns,
    dataWarnings: input.dataWarnings,
  })

  return {
    kpis: {
      productionAgents: computeProductionAgents(input.copilots),
      readyForManualTest: latestDeliveries.length > 0 ? computeReadyForManualTest(latestDeliveries) : 0,
      sandboxPassRate: computeSandboxPassRate(sandboxSnapshots),
      avgRepoFit: computeAvgRepoFit(repoFitScores),
      blockedDeliveries: computeBlockedDeliveries(
        copilotIds,
        input.latestDeliveryByCopilot,
        input.latestSandboxByCopilot,
        input.scorecards,
        input.missionRuns
      ),
      executableNow: input.availableAgents === null ? null : input.availableAgents.filter(isExecutable).length,
      executableTotal: input.availableAgents === null ? null : input.availableAgents.length,
      // A failed read has NO length. `null` here, never 0 — 0 would claim the
      // window was read and held nothing, which is the opposite of what happened.
      runs24h: input.windowRuns === null ? null : input.windowRuns.length,
      success24h: computeSuccess24h(input.windowRuns),
      cost24h: computeCost24h(input.windowRuns),
      needsAction: actionItems.length,
    },
    projects: buildProjectOverview(input.projects, input.copilots),
    actionItems,
    dataWarnings: input.dataWarnings,
    windowRuns: input.windowRuns,
  }
}

// ---------------------------------------------------------------------------
// Server collector — read-only, fail-soft
// ---------------------------------------------------------------------------

type RawRow = Record<string, unknown>

function latestByCopilot<T extends { copilotId: string }>(rows: T[]): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) {
    if (!map.has(row.copilotId)) map.set(row.copilotId, row)
  }
  return map
}

async function fetchLatestDeliveryEvents(): Promise<Map<string, DeliveryEvent>> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'agent_delivery_events?select=*&order=created_at.desc&limit=200'
    )
    const map = new Map<string, DeliveryEvent>()
    for (const row of rows) {
      const copilotId = row.copilot_id as string
      if (map.has(copilotId)) continue
      map.set(copilotId, {
        id: row.id as string,
        mode: row.mode as DeliveryEvent['mode'],
        targetRepo: row.target_repo as string,
        targetBranch: (row.target_branch as string | null) ?? null,
        deliveryBranch: (row.delivery_branch as string | null) ?? null,
        commitSha: (row.commit_sha as string | null) ?? null,
        commitUrl: (row.commit_url as string | null) ?? null,
        prUrl: (row.pr_url as string | null) ?? null,
        prNumber: (row.pr_number as number | null) ?? null,
        status: row.status as string,
        createdAt: row.created_at as string,
      })
    }
    return map
  } catch {
    return new Map()
  }
}

async function fetchLatestSandboxSnapshots(): Promise<Map<string, SandboxSnapshot>> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'sandbox_reports?select=copilot_id,status,sandbox_fit_score,repo_fit_score,report,created_at&order=created_at.desc&limit=200'
    )
    const snapshots: SandboxSnapshot[] = []
    for (const row of rows) {
      const copilotId = row.copilot_id as string | null
      if (!copilotId) continue
      let repo: string | null = null
      try {
        const report = parseSandboxReport(row.report)
        repo = report.repo
      } catch {
        repo = null
      }
      snapshots.push({
        copilotId,
        status: row.status as SandboxSnapshot['status'],
        sandboxFitScore: (row.sandbox_fit_score as number | null) ?? null,
        repoFitScore: (row.repo_fit_score as number | null) ?? null,
        repo,
        createdAt: row.created_at as string,
      })
    }
    return latestByCopilot(snapshots)
  } catch {
    return new Map()
  }
}

async function fetchMissionRuns(): Promise<{ runs: MissionRunSnapshot[]; warning: string | null }> {
  try {
    const rows = await pgrest<RawRow[]>(
      'GET',
      'mission_runs?select=*&order=created_at.desc&limit=10'
    )
    return {
      runs: rows.map((row) => ({
        id: row.id as string,
        projectId: row.project_id as string,
        objective: row.objective as string,
        status: row.status as string,
        decision: (row.decision as string | null) ?? null,
        repo: (row.repo as string | null) ?? null,
        updatedAt: (row.updated_at as string) ?? (row.created_at as string),
        report: (row.report as MissionReport | null) ?? null,
      })),
      warning: null,
    }
  } catch {
    return { runs: [], warning: 'Mission data unavailable' }
  }
}

/**
 * The human sentence pushed into `dataWarnings` when the 24h run read fails.
 *
 * Same register as the two warnings already in that array ("Mission data
 * unavailable", "Executable-agent data unavailable") — `dataWarnings` holds
 * sentences and the UI prints them VERBATIM, so this is not a machine code.
 * Exported so a consumer can recognise "runs24h is null because it was unread"
 * without re-typing the string and drifting from it.
 */
export const RUNS_READ_FAILED_WARNING = 'Run history unavailable'

/**
 * Read-only dashboard overview for /admin. Never writes, never calls GitHub.
 *
 * List-friendly: one parallel PostgREST wave only. Per-agent delivery scorecards
 * (`getDeliveryScorecard`) are intentionally omitted — each costs 10–15 remote
 * RTTs and made /admin 12–48s. Release-gate / scorecard signals stay on the
 * agent detail pages; blocked KPIs here use delivery + sandbox + mission facts.
 */
export async function getDashboardOverview(nowMs: number = Date.now()): Promise<DashboardOverview> {
  const dataWarnings: string[] = []

  const [
    copilots,
    projects,
    latestDeliveryByCopilot,
    latestSandboxByCopilot,
    missionResult,
    availableAgentsResult,
    windowRunsResult,
  ] = await Promise.all([
    getCopilots({ health: 'list' }),
    getProjects(),
    fetchLatestDeliveryEvents(),
    fetchLatestSandboxSnapshots(),
    fetchMissionRuns(),
    getAvailableAgents()
      .then((agents) => ({ agents, warning: null as string | null }))
      .catch(() => ({ agents: null, warning: 'Executable-agent data unavailable' })),
    // Same idiom as getAvailableAgents() above — a failed read reports itself.
    // `catch(() => [])` used to sit here and made a dead backend look like a
    // quiet 24h: an empty array is indistinguishable from a healthy empty window.
    getRecentRunsInWindow({ nowMs })
      .then((runs) => ({ runs, warning: null as string | null }))
      .catch(() => ({ runs: null, warning: RUNS_READ_FAILED_WARNING })),
  ])

  if (missionResult.warning) dataWarnings.push(missionResult.warning)
  if (availableAgentsResult.warning) dataWarnings.push(availableAgentsResult.warning)
  if (windowRunsResult.warning) dataWarnings.push(windowRunsResult.warning)

  return assembleDashboardOverview({
    copilots,
    projects,
    latestDeliveryByCopilot,
    latestSandboxByCopilot,
    scorecards: new Map(),
    missionRuns: missionResult.runs,
    dataWarnings,
    availableAgents: availableAgentsResult.agents,
    windowRuns: windowRunsResult.runs,
  })
}
