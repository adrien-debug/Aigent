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
// Historical projects screen (removed in frontend reset). They live in their own neutral
// module because this one opens with `import 'server-only'` and a component
// cannot take a value from it — see health-measure.ts for the full reason.
import { sumMeasuredHealth } from './health-measure'
import type { MissionReport } from './mission-orchestrator'
import { pgrest } from './postgrest'
import { isExecutable } from './runtime-catalogue'
import { parseSandboxReport, type TargetRepoSandboxReport } from './target-repo-sandbox'
import { diagnoseTelemetryHealth, type TelemetryHealthDiagnostic } from './telemetry-health'
import {
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
  type RuntimeTelemetryEvent,
} from './runtime-telemetry-store'
import {
  listPendingArchitectApprovals,
  type PendingArchitectApproval,
} from './pending-architect-approvals'
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
  | 'architect_approval'
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
  /**
   * L'agent concerné, quand la ligne en porte un.
   *
   * Ces deux identifiants ont d'abord été omis : `meta` composait déjà un
   * libellé lisible (« Market Intelligence · adrien-debug/TradeAgent »), donc
   * l'information PARAISSAIT présente. Elle ne l'était pas — un libellé n'est
   * pas une clé. Toute surface voulant filtrer par agent ou par projet devait
   * soit re-parser une chaîne d'affichage, soit renoncer. `/actions` avait
   * renoncé.
   *
   * Ils sont donc conservés à la dérivation, là où ils sont connus sans coût :
   * `copilotId` vient de la clé de `latestDeliveryByCopilot`, `projectId` du
   * copilot résolu ou de l'approbation architecte. Aucun aller-retour
   * supplémentaire.
   *
   * `null` quand la ligne n'en porte réellement pas — une panne de source
   * (`data_unavailable`) n'appartient à aucun agent.
   */
  copilotId: string | null
  /** Le projet concerné, même contrat que `copilotId`. */
  projectId: string | null
}

export type DashboardOverview = {
  kpis: DashboardKpis
  projects: ProjectOverviewItem[]
  /**
   * Les copilots tels que lus, exposés pour que l'UI puisse résoudre un
   * `copilotId` en NOM sans relire la base — `windowRuns` ne porte que des ids,
   * et « run-a3f… » ne renseigne personne. Jointure en mémoire, zéro aller-retour
   * supplémentaire. Un id non résolu reste non résolu : on n'invente pas de nom.
   */
  copilots: Copilot[]
  /** Même raison que `copilots`, pour résoudre un `projectId`. */
  projectRows: Project[]
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
  /**
   * Health of the runtime-telemetry CHANNEL, not of any agent — see
   * telemetry-health.ts's doctrine header, which this diagnostic enforces.
   * `agentsWithTelemetryDeclared` is always `null` here: the manifest-level
   * declaration count needs a per-copilot manifest resolve (2-3 round trips
   * each, `getManifestForCopilot`), which is exactly the N+1 this module's
   * own doc comment (`getDashboardOverview`) already refuses to pay for
   * scorecards. So level 1 (declared) stays UNAVAILABLE on this screen by
   * design; levels 2/3 (ingestion configured, events actually received) are
   * cheap — one bounded fleet query — and ARE measured.
   */
  telemetryHealth: TelemetryHealthDiagnostic
  /** Distinct (project, agent) pairs that have EVER reported a runtime
   *  telemetry event, from the same bounded fleet read as `telemetryHealth`.
   *  `null` only if that read itself failed. */
  telemetryReportingAgents: number | null
  /** Runs measured over the bounded recent window read for `telemetryHealth`
   *  (last 2000 events, terminal + in-flight) — an EXTERNAL count, distinct
   *  from `kpis.runs24h` which is Aigent's own executed runs. `null` only if
   *  the fleet telemetry read itself failed. */
  telemetryRunsMeasured: number | null
  /**
   * The latest delivery event per copilot, newest first, capped — the SAME
   * `latestDeliveryByCopilot` map `buildActionItems` already reads for the
   * `ready_manual`/`pr_open` queue items, now surfaced whole so the overview
   * can show a "recent deliveries" panel instead of leaving this read stuck
   * inside the action-queue derivation. No second fetch: this is a view over
   * a map the collector already built.
   *
   * `null` ONLY when the underlying read failed (`latestDeliveryByCopilot ===
   * null` — see `DELIVERY_READ_FAILED_WARNING`), never when it succeeded and
   * found nothing: an empty fleet with no delivery yet is `[]`, a measured
   * emptiness, same three-state contract as `windowRuns`.
   */
  recentDeliveries: RecentDelivery[] | null
  /**
   * Project-builder conversations paused at the LangGraph approval interrupt.
   * `null` only when the pending-approval scan could not run (DB read failed).
   */
  pendingArchitectApprovals: PendingArchitectApproval[] | null
  /**
   * Raw runtime-telemetry events, newest first — the per-event feed that
   * `summarizeFleetRuntimeTelemetry` rolls up for the channel KPIs above.
   * `null` only when the events table could not be read.
   */
  recentTelemetryEvents: RuntimeTelemetryEvent[] | null
}

/** One delivery event with the copilot it belongs to — `DeliveryEvent` itself
 *  carries no `copilotId` (it is the Map key in `latestDeliveryByCopilot`). */
export type RecentDelivery = {
  copilotId: string
  event: DeliveryEvent
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
  if (input.scorecard?.level === 'not_ready' && input.scorecard.blockers.length > 0) return true
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
      // function the project surface calls, so the two screens cannot reach
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
    .toSorted((a, b) => {
      const aSignal = a.passRate !== null || (a.runsLast24h !== null && a.runsLast24h > 0) ? 1 : 0
      const bSignal = b.passRate !== null || (b.runsLast24h !== null && b.runsLast24h > 0) ? 1 : 0
      return bSignal - aSignal || runsOrderKey(b) - runsOrderKey(a) || a.name.localeCompare(b.name)
    })
}

// ---------------------------------------------------------------------------
// Pure — recent deliveries
// ---------------------------------------------------------------------------

/** Cap for the "recent deliveries" panel — a dense list, not a full log. */
export const RECENT_DELIVERIES_LIMIT = 8

/** Newest-first view over the latest-per-copilot delivery map. Pure so the
 *  ordering/limit rule is unit-testable without a fetch. */
export function buildRecentDeliveries(
  latestDeliveryByCopilot: Map<string, DeliveryEvent> | null,
  limit = RECENT_DELIVERIES_LIMIT
): RecentDelivery[] | null {
  if (latestDeliveryByCopilot === null) return null
  return [...latestDeliveryByCopilot.entries()]
    .map(([copilotId, event]) => ({ copilotId, event }))
    .toSorted((a, b) => Date.parse(b.event.createdAt) - Date.parse(a.event.createdAt))
    .slice(0, limit)
}

// ---------------------------------------------------------------------------
// Pure — action items
// ---------------------------------------------------------------------------

const ACTION_PRIORITY: Record<ActionItemKind, number> = {
  architect_approval: 0,
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
  /** Null when the delivery-event read FAILED — see the module doc on
   *  `fetchLatestDeliveryEvents`. Distinct from an empty (proven-zero) Map:
   *  a failed read cannot say "nobody is ready for manual test", it can only
   *  say it does not know, which is why it earns its own queue item below
   *  rather than being silently skipped. */
  latestDeliveryByCopilot: Map<string, DeliveryEvent> | null
  /** Null when the sandbox-report read FAILED — same reasoning. */
  latestSandboxByCopilot: Map<string, SandboxSnapshot> | null
  scorecards: Map<string, ScorecardSnapshot>
  missionRuns: MissionRunSnapshot[]
  dataWarnings: string[]
  /** Null when `listPendingArchitectApprovals()` failed — same contract as delivery/sandbox maps. */
  pendingArchitectApprovals: PendingArchitectApproval[] | null
  limit?: number
}): ActionItem[] {
  const items: ActionItem[] = []

  if (input.pendingArchitectApprovals === null) {
    items.push({
      id: 'action_data_unavailable_architect',
      kind: 'data_unavailable',
      title: 'Architect approvals could not be scanned',
      meta: 'HITL runs waiting for confirmation are not represented this round.',
      status: 'unavailable',
      href: '/',
      buttonLabel: 'Retry',
      priority: ACTION_PRIORITY.data_unavailable,
      copilotId: null,
      projectId: null,
    })
  } else {
    for (const approval of input.pendingArchitectApprovals) {
      const project = input.projectsById.get(approval.projectId)
      items.push({
        id: `action_architect_${approval.conversationId}`,
        kind: 'architect_approval',
        title: 'Architect draft awaiting approval',
        meta: `${project?.name ?? approval.projectId} · thread ${approval.threadId.slice(0, 8)}`,
        status: 'awaiting_approval',
        href: `/projects/${approval.projectId}/builder`,
        buttonLabel: 'Open builder',
        priority: ACTION_PRIORITY.architect_approval,
        copilotId: null,
        projectId: approval.projectId,
      })
    }
  }

  // A failed read is an ITEM in the queue, not a silent gap in it: the two
  // sources this loop depends on can fail independently of the reads that
  // built copilots/projects, and an operator scanning an apparently-quiet
  // queue has no other signal that "ready for manual test" and "sandbox
  // failed" were never actually checked this round.
  if (input.latestDeliveryByCopilot === null) {
    items.push({
      id: 'action_data_unavailable_delivery',
      kind: 'data_unavailable',
      title: 'Delivery events could not be read',
      meta: 'Ready-for-manual-test and PR items are not represented this round.',
      status: 'unavailable',
      href: '/',
      buttonLabel: 'Retry',
      priority: ACTION_PRIORITY.data_unavailable,
      copilotId: null,
      projectId: null,
    })
  }
  if (input.latestSandboxByCopilot === null) {
    items.push({
      id: 'action_data_unavailable_sandbox',
      kind: 'data_unavailable',
      title: 'Sandbox reports could not be read',
      meta: 'Sandbox-failure items are not represented this round.',
      status: 'unavailable',
      href: '/',
      buttonLabel: 'Retry',
      priority: ACTION_PRIORITY.data_unavailable,
      copilotId: null,
      projectId: null,
    })
  }

  for (const [copilotId, evt] of input.latestDeliveryByCopilot ?? []) {
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
        href: `/agents/${copilotId}`,
        buttonLabel: 'Review',
        priority: ACTION_PRIORITY.ready_manual,
        copilotId: copilotId,
        projectId: copilot.projectId ?? null,
      })
    }

    const sandbox = input.latestSandboxByCopilot?.get(copilotId)
    if (sandbox?.status === 'failed') {
      items.push({
        id: `action_sandbox_${copilotId}`,
        kind: 'sandbox_failed',
        title: 'Sandbox failed',
        meta,
        status: 'failed',
        href: `/agents/${copilotId}`,
        buttonLabel: 'View Sandbox',
        priority: ACTION_PRIORITY.sandbox_failed,
        copilotId: copilotId,
        projectId: copilot.projectId ?? null,
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
        href: `/agents/${copilotId}`,
        buttonLabel: 'View Scorecard',
        priority: ACTION_PRIORITY.release_gate_red,
        copilotId: copilotId,
        projectId: copilot.projectId ?? null,
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
        copilotId: copilotId,
        projectId: copilot.projectId ?? null,
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
      href: project ? `/projects/${project.id}` : '/',
      buttonLabel: 'View Mission',
      priority: ACTION_PRIORITY.mission_blocked,
      copilotId: null,
      projectId: mission.projectId,
    })
  }

  // System-level ingest warnings belong in DashboardDataWarnings — not the
  // operator action queue (there is no button that fixes a missing table).
  return items
    .toSorted((a, b) => a.priority - b.priority)
    .slice(0, input.limit ?? 6)
}

// ---------------------------------------------------------------------------
// Pure — assemble overview from snapshots
// ---------------------------------------------------------------------------

export function assembleDashboardOverview(input: {
  copilots: Copilot[]
  projects: Project[]
  /** Null when `fetchLatestDeliveryEvents()` failed — kept distinct from an
   *  empty (proven-zero) Map exactly like `availableAgents`/`windowRuns`
   *  below, so `readyForManualTest` can render `Indisponible` instead of a
   *  reassuring 0, and the action queue can say so instead of quietly
   *  shipping fewer items than it should. */
  latestDeliveryByCopilot: Map<string, DeliveryEvent> | null
  /** Null when `fetchLatestSandboxSnapshots()` failed — same reasoning. */
  latestSandboxByCopilot: Map<string, SandboxSnapshot> | null
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
  /** Diagnostic already computed by the caller — pure pass-through, kept as
   *  an input like everything else here so this function stays a single
   *  synchronous assembly with no I/O of its own. */
  telemetryHealth: TelemetryHealthDiagnostic
  telemetryReportingAgents: number | null
  telemetryRunsMeasured: number | null
  pendingArchitectApprovals: PendingArchitectApproval[] | null
  recentTelemetryEvents: RuntimeTelemetryEvent[] | null
  /**
   * Plafond de la file d'action. Absent = le défaut de `buildActionItems` (6),
   * la troncature voulue par l'aperçu, qui n'a de place que pour une colonne.
   *
   * `/actions` et `/learning` sont des surfaces de revue DÉDIÉES : elles
   * passent une limite haute pour obtenir la file complète. Le paramètre
   * traverse jusqu'ici plutôt que de laisser un appelant re-dériver la file
   * lui-même, parce qu'une re-dérivation ne dispose PAS des mêmes entrées —
   * `latestSandboxByCopilot`, `scorecards` et `missionRuns` ne sont pas exposés
   * sur `DashboardOverview`. Un appelant qui les remplacerait par `null`/vide
   * produirait deux mensonges symétriques : des lignes « source indisponible »
   * pour des sources qui ont été lues sans erreur, et la disparition
   * silencieuse des lignes sandbox/gate/mission réelles. Une seule dérivation,
   * les mêmes entrées, une limite qui varie : c'est la seule forme qui garde
   * l'aperçu et la file complète d'accord entre eux.
   */
  actionItemsLimit?: number
}): DashboardOverview {
  const copilotsById = new Map(input.copilots.map((c) => [c.id, c]))
  const projectsById = new Map(input.projects.map((p) => [p.id, p]))
  const copilotIds = input.copilots.map((c) => c.id)

  // Local consts, not repeated `input.x` property reads: TypeScript narrows a
  // destructured local across a control-flow check far more reliably than a
  // property access on a parameter, and `blockedDeliveries` below depends on
  // both being proven non-null together.
  const { latestDeliveryByCopilot, latestSandboxByCopilot } = input

  const latestDeliveries = latestDeliveryByCopilot === null ? [] : [...latestDeliveryByCopilot.values()]
  const sandboxSnapshots = latestSandboxByCopilot === null ? [] : [...latestSandboxByCopilot.values()]
  const repoFitScores = [
    ...sandboxSnapshots.map((s) => s.repoFitScore).filter((n): n is number => n != null),
    ...[...input.scorecards.values()].map((s) => s.repoFitScore).filter((n): n is number => n != null),
  ]

  const actionItems = buildActionItems({
    copilotsById,
    projectsById,
    latestDeliveryByCopilot,
    latestSandboxByCopilot,
    scorecards: input.scorecards,
    missionRuns: input.missionRuns,
    dataWarnings: input.dataWarnings,
    pendingArchitectApprovals: input.pendingArchitectApprovals,
    limit: input.actionItemsLimit,
  })

  return {
    copilots: input.copilots,
    projectRows: input.projects,
    kpis: {
      productionAgents: computeProductionAgents(input.copilots),
      // A failed delivery-event read has NO length either — same rule as
      // `runs24h` below. `0` here would tell an operator "nobody is ready for
      // manual test" when the true fact is "we could not check".
      readyForManualTest:
        latestDeliveryByCopilot === null
          ? null
          : latestDeliveries.length > 0
            ? computeReadyForManualTest(latestDeliveries)
            : 0,
      sandboxPassRate: computeSandboxPassRate(sandboxSnapshots),
      avgRepoFit: computeAvgRepoFit(repoFitScores),
      // Blocking status is derived from BOTH the delivery and the sandbox
      // read (`isBlockedDelivery` reads both statuses per copilot) — if
      // either failed, the count is not a lower bound, it is unknowable, so
      // it must not be presented as measured.
      blockedDeliveries:
        latestDeliveryByCopilot === null || latestSandboxByCopilot === null
          ? null
          : computeBlockedDeliveries(
              copilotIds,
              latestDeliveryByCopilot,
              latestSandboxByCopilot,
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
    telemetryHealth: input.telemetryHealth,
    telemetryReportingAgents: input.telemetryReportingAgents,
    telemetryRunsMeasured: input.telemetryRunsMeasured,
    recentDeliveries: buildRecentDeliveries(latestDeliveryByCopilot),
    pendingArchitectApprovals: input.pendingArchitectApprovals,
    recentTelemetryEvents: input.recentTelemetryEvents,
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

/**
 * Reads the LATEST delivery event per copilot. Deliberately lets a read
 * failure REJECT rather than swallowing it — the caller (`getDashboardOverview`)
 * is what turns a rejection into a warning + a `null` map, exactly like
 * `getAvailableAgents`/`getRecentRunsInWindow`. A `try/catch` here that
 * returned `new Map()` on failure used to make a dead `agent_delivery_events`
 * table indistinguishable from a genuinely empty one — the caller's `.then/
 * .catch` wrapper could never fire because this promise never rejected.
 */
async function fetchLatestDeliveryEvents(): Promise<Map<string, DeliveryEvent>> {
  const rows = await pgrest<RawRow[]>('GET', 'agent_delivery_events?select=*&order=created_at.desc&limit=200')
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
}

/**
 * Reads the LATEST sandbox report per copilot. Same reasoning as
 * `fetchLatestDeliveryEvents` above: the read failure is left to REJECT, not
 * swallowed here, so the caller can distinguish "the table is dead" from "the
 * table is empty". The inner try/catch around `parseSandboxReport` is a
 * DIFFERENT, legitimate case — one row's `report` blob being unparseable is
 * not a read failure, it just leaves that row's `repo` unresolved.
 */
async function fetchLatestSandboxSnapshots(): Promise<Map<string, SandboxSnapshot>> {
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

/** Same idea as `RUNS_READ_FAILED_WARNING`, for the delivery-event read. */
export const DELIVERY_READ_FAILED_WARNING = 'Delivery event data unavailable'

/** Same idea as `RUNS_READ_FAILED_WARNING`, for the sandbox-report read. */
export const SANDBOX_READ_FAILED_WARNING = 'Sandbox report data unavailable'

/** Same idea as `RUNS_READ_FAILED_WARNING`, for the fleet runtime-telemetry read. */
export const TELEMETRY_READ_FAILED_WARNING = 'Runtime telemetry data unavailable'
export const TELEMETRY_EVENTS_READ_FAILED_WARNING = 'Runtime telemetry event feed unavailable'
export const ARCHITECT_APPROVALS_READ_FAILED_WARNING = 'Architect approval queue unavailable'

/**
 * Plafond des surfaces de revue dédiées (`/actions`, `/learning`).
 *
 * Ce n'est pas « pas de limite » : une file non bornée rendrait un écran que
 * personne ne peut lire et une page dont le coût de rendu suit la taille de la
 * flotte. C'est un plafond assez haut pour qu'aucune file réelle ne le touche,
 * et il reste EXPLICITE — si une flotte l'atteint un jour, l'UI doit le dire
 * plutôt que de tronquer en silence.
 */
export const FULL_ACTION_QUEUE_LIMIT = 500

/**
 * Read-only dashboard overview for the operator cockpit (`/`). Never writes,
 * never calls GitHub.
 *
 * List-friendly: one parallel PostgREST wave only. Per-agent delivery scorecards
 * (`getDeliveryScorecard`) are intentionally omitted — verified N+1, not a single
 * batchable read: each copilot's scorecard runs `evaluateReleaseGate` plus a
 * repo-intelligence load, test-suite/test-case fetches and a tool lookup
 * (`delivery-scorecard-server.ts`), none of it expressible as one `in.(...)`
 * PostgREST wave the way `data.ts`'s other batched reads are — it is 10–15 remote
 * RTTs PER COPILOT and made the cockpit 12–48s. There is no cheap batched substitute,
 * so `scorecards` stays an empty Map here rather than pretending otherwise.
 *
 * This is NOT a silent zero: `computeAvgRepoFit`/`buildActionItems` already
 * treat an empty scorecards Map as "not measured" —
 *  · `avgRepoFit` falls back to sandbox-report `repoFitScore` only (a real,
 *    separately-loaded signal) and is `null` when even that is empty —
 *    `overview-screen.tsx` renders `Unavailable`, never 0.
 *  · `release_gate_red` action items simply cannot fire (they read
 *    `scorecards.get(copilotId)?.releaseGateRed`, which is always `undefined`
 *    here) — an absent item, not a fabricated "0 red gates".
 * Release-gate / scorecard signals stay on the agent detail pages, which pay the
 * per-copilot cost once for the one copilot being viewed.
 */
export async function getDashboardOverview(
  nowMs: number = Date.now(),
  options: Readonly<{ actionItemsLimit?: number }> = {}
): Promise<DashboardOverview> {
  const dataWarnings: string[] = []

  const [
    copilots,
    projects,
    latestDeliveryResult,
    latestSandboxResult,
    missionResult,
    availableAgentsResult,
    windowRunsResult,
    fleetTelemetryResult,
    pendingArchitectApprovalsResult,
    telemetryEventsResult,
  ] = await Promise.all([
    getCopilots({ health: 'list' }),
    getProjects(),
    // Same idiom as getAvailableAgents() below — a failed read reports itself.
    // `catch { return new Map() }` used to sit inside fetchLatestDeliveryEvents
    // and made a dead `agent_delivery_events` table look like a genuinely empty
    // one: readyForManualTest rendered a confident 0, and the action queue
    // silently lost every ready-for-manual-test / PR item with no signal at all.
    fetchLatestDeliveryEvents()
      .then((map) => ({ map, warning: null as string | null }))
      .catch(() => ({ map: null, warning: DELIVERY_READ_FAILED_WARNING })),
    // Same idiom, for `sandbox_reports`. A dead table used to render as a
    // proven-empty one — no blocked-sandbox action item, no signal.
    fetchLatestSandboxSnapshots()
      .then((map) => ({ map, warning: null as string | null }))
      .catch(() => ({ map: null, warning: SANDBOX_READ_FAILED_WARNING })),
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
    // One bounded query (last 2000 events, same read `summarizeFleetRuntimeTelemetry`
    // already does for a would-be dedicated telemetry surface) — added to THIS wave instead
    // of a second round trip. A failed read reports itself via `lookupFailed`,
    // never a fabricated "no events" for a channel that could not be checked.
    summarizeFleetRuntimeTelemetry()
      .then((summary) => ({ summary, lookupFailed: false }))
      .catch(() => ({ summary: null, lookupFailed: true })),
    listPendingArchitectApprovals()
      .then((approvals) => ({ approvals, warning: null as string | null }))
      .catch(() => ({ approvals: null, warning: ARCHITECT_APPROVALS_READ_FAILED_WARNING })),
    listRecentRuntimeTelemetryEvents(50)
      .then((events) => ({ events, warning: null as string | null }))
      .catch(() => ({ events: null, warning: TELEMETRY_EVENTS_READ_FAILED_WARNING })),
  ])

  if (latestDeliveryResult.warning) dataWarnings.push(latestDeliveryResult.warning)
  if (latestSandboxResult.warning) dataWarnings.push(latestSandboxResult.warning)
  if (missionResult.warning) dataWarnings.push(missionResult.warning)
  if (availableAgentsResult.warning) dataWarnings.push(availableAgentsResult.warning)
  if (windowRunsResult.warning) dataWarnings.push(windowRunsResult.warning)
  if (fleetTelemetryResult.lookupFailed) dataWarnings.push(TELEMETRY_READ_FAILED_WARNING)
  if (pendingArchitectApprovalsResult.warning) dataWarnings.push(pendingArchitectApprovalsResult.warning)
  if (telemetryEventsResult.warning) dataWarnings.push(telemetryEventsResult.warning)

  const telemetryHealth = diagnoseTelemetryHealth({
    ingestionTokenConfigured: Boolean(process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN),
    // Level-1 (manifest-declared) count needs a per-copilot manifest resolve —
    // deliberately not paid for on this screen (see `telemetryHealth` on
    // `DashboardOverview`). Always `null`: `diagnoseTelemetryHealth` treats
    // that as "cannot determine" and returns status `unavailable` whenever
    // the ingestion token IS configured, which is the honest read for a
    // figure this collector never attempted to measure — never a guessed 0.
    agentsWithTelemetryDeclared: null,
    lastEventReceivedAt: fleetTelemetryResult.summary?.lastSeenAt ?? null,
    lastEventLookupFailed: fleetTelemetryResult.lookupFailed,
    now: new Date(nowMs).toISOString(),
    muteThresholdDays: 7,
  })

  return assembleDashboardOverview({
    copilots,
    projects,
    latestDeliveryByCopilot: latestDeliveryResult.map,
    latestSandboxByCopilot: latestSandboxResult.map,
    scorecards: new Map(),
    missionRuns: missionResult.runs,
    dataWarnings,
    availableAgents: availableAgentsResult.agents,
    windowRuns: windowRunsResult.runs,
    telemetryHealth,
    telemetryReportingAgents: fleetTelemetryResult.summary?.reportingAgents ?? null,
    telemetryRunsMeasured: fleetTelemetryResult.summary?.totalRuns ?? null,
    pendingArchitectApprovals: pendingArchitectApprovalsResult.approvals,
    recentTelemetryEvents: telemetryEventsResult.events,
    actionItemsLimit: options.actionItemsLimit,
  })
}
