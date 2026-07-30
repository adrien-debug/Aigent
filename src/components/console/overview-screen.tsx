import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { DashboardOverview, RecentDelivery } from '@/lib/agent-mission-control/dashboard-overview'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'
import {
  classifyRuntimeTelemetryProvenance,
  type RuntimeTelemetryProvenance,
} from '@/lib/agent-mission-control/runtime-telemetry-provenance'
import type { TelemetryHealthStatus } from '@/lib/agent-mission-control/telemetry-health'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import that crosses into a sub-directory matches neither, so these three files
// read as dead components and the gate goes red.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { NoDataChart } from './charts/no-data-chart'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import { TrendChart, type TrendSeries } from '@/components/console/charts/trend-chart'
import {
  DegradedBanner,
  EmptyState,
  ErrorState,
  KpiCard,
  PanelRow,
  ScreenHeader,
  Section,
  Unavailable,
} from './screen-primitives'

/**
 * The flagship screen: the whole 24h control-plane window in one dense grid.
 *
 * SERVER COMPONENT. No `'use client'`, no state, no effect — every figure here
 * is read once on the server from the `DashboardOverview` the route already
 * loaded, and every chart is hand-written SVG (`./charts/*`). Nothing on this
 * page hydrates.
 *
 * WHAT IS DERIVED HERE AND WHAT IS NOT. The KPI band renders `overview.kpis`
 * verbatim — a figure the data layer already computed is never recomputed here,
 * or two blocks of the same page would eventually disagree about the same fact.
 * What IS derived, in the pure helpers above the component, is PRESENTATION over
 * `overview.windowRuns`: bucketing the runs into a time series, counting them by
 * status, grouping them by agent. That is view logic over data the route already
 * fetched, not a second read and not a backend change.
 *
 * TRUTH. `number | null` is the contract's way of saying "never measured", and
 * it renders as the word `Indisponible` (`<Unavailable />`) — never 0, never
 * "0%", never a gauge arc drawn at zero length. A MEASURED zero renders `0`. No
 * `?? 0` on a metric lives in this file; where a ratio needs both halves to
 * exist, the pair is narrowed to a single nullable object instead of being
 * coalesced apart.
 *
 * THE 24h WINDOW HAS THREE STATES AND ALL THREE ARE VISIBLE ON SCREEN.
 * `overview.windowRuns` is `AgentRun[] | null`:
 *   · `[…]`  — read OK, runs observed. Measured figures, real chart, real fleet.
 *   · `[]`   — read OK and the window held nothing. A MEASURED emptiness: the
 *              KPI reads `0`, the chart draws its own "no run in this window"
 *              plate, every per-status count reads `0`, and the Agents list
 *              shows its calm `EmptyState`. Nothing is wrong and nothing here
 *              pretends otherwise.
 *   · `null` — the read FAILED. Every figure derived from it says
 *              `Indisponible`, the panels whose whole body came from that read
 *              wear the danger role, and `dataWarnings` carries the sentence
 *              that explains it (top banner + Platform status). An unread window
 *              is NEVER drawn as a quiet one: no empty axis, no flat-zero curve,
 *              no empty fleet, no calm `EmptyState`.
 * The narrowing happens ONCE, in `windowRuns` below, and the three pure helpers
 * still take a plain `AgentRun[]` — so a failed read cannot reach a chart as an
 * empty array on the way to the pixels. That substitution is the whole defect
 * this screen was fixed for.
 */

/* --------------------------------------------------------------- constants */

/** Buckets in the flagship chart. Their BOUNDARIES come from the observed run
 *  timestamps (see `bucketRunsByStartTime`), never from a wall-clock grid. */
const TREND_BUCKET_COUNT = 12

/**
 * The run status vocabulary, in the order the supporting list renders it.
 *
 * These are the ENUM VALUES from `AgentRunStatus` (lower-case, hyphenated),
 * shown verbatim — exactly as `runs-screen.tsx` already shows `run.status`. They
 * are data, not a display vocabulary this file invented, so no second spelling
 * of a status can drift from the first.
 */
const RUN_STATUSES: readonly AgentRunStatus[] = [
  'completed',
  'failed',
  'blocked',
  'needs-confirmation',
  'running',
]

/**
 * Every route this console actually serves. An `ActionItem.href` is built by the
 * data layer from rows that outlived the screens they pointed at, so a href is
 * treated as a CLAIM and checked before it becomes a link: a control that leads
 * to a 404 is a dead control. An unmatched href still renders — as plain text,
 * because the destination is a fact worth showing even when it is unreachable.
 */
const REAL_ROUTES: readonly RegExp[] = [
  /^\/admin$/,
  /^\/admin\/runs$/,
  /^\/admin\/projects$/,
  /^\/admin\/agents$/,
  /^\/admin\/agents\/[^/]+$/,
  /^\/admin\/projects\/[^/]+\/builder$/,
]

/** The `md`-rung bounded body: a list panel is 320px tall whether it holds 2
 *  rows or 200, and the overflow scrolls INSIDE it. Matches `Section`'s own
 *  `scroll="md"` rung, so a panel that needs a footer outside the scroll area
 *  still lines up with one that does not. */
const LIST_SCROLL = 'max-h-80 overflow-y-auto'

/* ----------------------------------------------------------------- helpers */

/** `Indisponible` sized for the big KPI figure slot (the `<p>` around it is
 *  `text-2xl`, which a 12-glyph word does not survive). */
const unavailableFigure = <Unavailable className="text-base/7" />

/** `Indisponible` sized for a `PanelRow` stat (the slot is `text-[13px]/5`).
 *  Same rung `projects-screen` uses for the bench rows, so the same absence is
 *  the same size on both screens. */
const unavailableValue = <Unavailable className="text-[11px]" />

/**
 * Plain-English label for `TelemetryHealthDiagnostic.status` — the SAME five
 * states `telemetry-health.ts` defines, worded for a one-line dl value. Never
 * "healthy" on config presence alone (that module's own doctrine): `healthy`
 * only reaches this label when the diagnostic already required a real event
 * within the mute window, so no extra guard is needed here.
 */
function telemetryStatusLabel(status: TelemetryHealthStatus): React.ReactNode {
  switch (status) {
    case 'not_configured':
      return <span className="text-content-muted">Not configured</span>
    case 'incomplete_configuration':
      return <span className="text-content-muted">No agent declares it</span>
    case 'loop_muted':
      return <span className="text-[var(--state-danger-text)]">Muted</span>
    case 'healthy':
      return <StatusDot tone="positive">Healthy</StatusDot>
    case 'unavailable':
      return <Unavailable className="text-[11px]/5" />
  }
}

/**
 * The sub-label of a window-derived KPI when the run read FAILED.
 *
 * The figure itself already says `Indisponible`; this says WHY, because
 * "Indisponible" under a detail line still claiming "Summed over the window's
 * runs" would read as a formatting glitch rather than a dead read. The measured
 * details stay untouched — they only describe a window that WAS read.
 */
const RUNS_UNREAD_DETAIL = 'Run history could not be read'

/**
 * Panel-level heading for the same failure. One spelling, three panels.
 *
 * DELIBERATELY A SECOND LITERAL, and the duplication is not an oversight.
 * The data layer exports this exact sentence as `RUNS_READ_FAILED_WARNING`, and
 * importing it would be the obvious fix — but `dashboard-overview.ts` starts
 * with `import 'server-only'`, so pulling in the VALUE (rather than the type)
 * drags that guard into this module's runtime graph and the component test
 * suite dies with "This module cannot be imported from a Client Component".
 * Measured, not assumed: the import was tried and
 * `tests/unit/overview-screen-truth.test.tsx` went red on it.
 *
 * So the two literals stay two, and the drift risk is real but bounded: the
 * heading is cosmetic, while the sentence that must match is the one the data
 * layer pushes into `dataWarnings` and the degraded banner prints verbatim.
 * Closing this properly means a client-safe module owning the display string —
 * out of scope here, and recorded rather than silently tolerated.
 */
const RUNS_UNREAD_TITLE = 'Run history unavailable'

/** UTC wall clock, formatted from the epoch without a locale so the label is
 *  identical on every server. The chart header says UTC out loud. */
function formatClockUtc(epochMs: number): string {
  const date = new Date(epochMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
}

/** UTC date + clock for a delivery row (`agent_delivery_events.created_at` can
 *  be days old, unlike the 24h-window trend header, so the day is spelled
 *  out too — `formatClockUtc` alone would misdate anything not from today). */
function formatDeliveryStamp(iso: string): string {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return iso
  const date = new Date(ms)
  const day = `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
  return `${day} ${formatClockUtc(ms)}`
}

/** A resolvable destination, or `null` when nothing on this console serves it.
 *  Absolute `http(s)` targets (a GitHub PR from a delivery event) are real
 *  destinations outside the app and pass through untouched. */
function resolveConsoleHref(href: string): string | null {
  if (/^https?:\/\//i.test(href)) return href
  const path = href.split(/[?#]/)[0]
  return REAL_ROUTES.some((route) => route.test(path)) ? href : null
}

/** Terminal outcomes get a coloured dot; everything else stays neutral or
 *  pending. A failure is NEVER painted in the accent. */
function runStatusTone(status: AgentRunStatus): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

/** `ActionItem.status` is a free-form string from several producers (delivery
 *  events, sandbox reports, mission runs). Only the two that mean "this is
 *  wrong" get the danger role; the rest stay neutral rather than guessing. */
function actionStatusTone(status: string): StatusDotTone {
  return status === 'failed' || status === 'blocked' ? 'negative' : 'neutral'
}

function telemetryProvenanceLabel(provenance: RuntimeTelemetryProvenance): string {
  switch (provenance) {
    case 'internal':
      return 'internal'
    case 'lifecycle':
      return 'lifecycle'
    case 'consumer':
      return 'consumer'
    case 'unknown':
      return 'unknown'
  }
}

type TrendBuckets = {
  xLabels: string[]
  completed: number[]
  failed: number[]
}

/**
 * Chronological buckets over the runs actually observed in the window.
 *
 * The first and last boundaries are the earliest and latest `startedAt` in
 * `windowRuns` — not "now minus 24h", which would draw a long flat stretch of
 * fabricated zeros before the first real run. A window with no run returns EMPTY
 * arrays, so `TrendChart` draws its own honest empty plate instead of an axis
 * over nothing. Runs sharing a single instant collapse into one bucket.
 *
 * TAKES AN ARRAY, NEVER A NULL, ON PURPOSE. The empty plate it produces is the
 * truthful answer for a window that WAS read and held nothing — and the exact
 * lie for a window nobody could read. Keeping the parameter non-nullable makes
 * the caller narrow first; `countRunsByStatus` and `groupRunsByAgent` below hold
 * the same line for the same reason.
 */
function bucketRunsByStartTime(runs: AgentRun[], bucketCount = TREND_BUCKET_COUNT): TrendBuckets {
  let first = Number.POSITIVE_INFINITY
  let last = Number.NEGATIVE_INFINITY
  for (const run of runs) {
    const started = Date.parse(run.startedAt)
    if (!Number.isFinite(started)) continue
    if (started < first) first = started
    if (started > last) last = started
  }
  if (!Number.isFinite(first) || !Number.isFinite(last)) {
    return { xLabels: [], completed: [], failed: [] }
  }

  const span = last - first
  const buckets = span > 0 ? Math.max(1, bucketCount) : 1
  const width = span > 0 ? span / buckets : 0

  const completed: number[] = Array.from({ length: buckets }, () => 0)
  const failed: number[] = Array.from({ length: buckets }, () => 0)
  for (const run of runs) {
    const started = Date.parse(run.startedAt)
    if (!Number.isFinite(started)) continue
    const raw = width > 0 ? Math.floor((started - first) / width) : 0
    const index = Math.min(buckets - 1, Math.max(0, raw))
    if (run.status === 'completed') completed[index] += 1
    else if (run.status === 'failed') failed[index] += 1
  }

  return {
    xLabels: Array.from({ length: buckets }, (_, index) => formatClockUtc(first + index * width)),
    completed,
    failed,
  }
}

/** How many runs of each status the window holds. Every entry is a MEASURED
 *  count, so a status nothing produced legitimately renders `0`. */
function countRunsByStatus(runs: AgentRun[]): Record<AgentRunStatus, number> {
  const counts: Record<AgentRunStatus, number> = {
    completed: 0,
    failed: 0,
    blocked: 0,
    'needs-confirmation': 0,
    running: 0,
  }
  for (const run of runs) counts[run.status] += 1
  return counts
}

type AgentActivity = {
  copilotId: string
  projectId: string
  runs: number
  completed: number
  failed: number
}

/**
 * The window's runs grouped per agent, busiest first.
 *
 * `DashboardOverview` does not carry the agent catalogue, so the identifier is
 * all this screen truly knows about an agent — and an id is a fact. Nothing here
 * invents a display name.
 */
function groupRunsByAgent(runs: AgentRun[]): AgentActivity[] {
  const byAgent = new Map<string, AgentActivity>()
  for (const run of runs) {
    const current =
      byAgent.get(run.copilotId) ??
      { copilotId: run.copilotId, projectId: run.projectId, runs: 0, completed: 0, failed: 0 }
    current.runs += 1
    if (run.status === 'completed') current.completed += 1
    else if (run.status === 'failed') current.failed += 1
    byAgent.set(run.copilotId, current)
  }
  return [...byAgent.values()].toSorted(
    (a, b) => b.runs - a.runs || a.copilotId.localeCompare(b.copilotId)
  )
}

/* --------------------------------------------------------------- component */

export function OverviewScreen({ overview }: { overview: DashboardOverview }) {
  const { kpis } = overview
  const degraded = overview.dataWarnings.length > 0

  // A ratio needs BOTH halves to exist. Narrowing the pair into one nullable
  // object keeps the "not measured" case whole — coalescing either half apart
  // would manufacture a denominator and, with it, a percentage.
  const executable =
    kpis.executableNow !== null && kpis.executableTotal !== null
      ? { now: kpis.executableNow, total: kpis.executableTotal }
      : null

  // THE ONE NARROWING. `null` means the 24h run read FAILED — not that the
  // window was quiet. Everything below branches on `windowRuns` before it can
  // touch a helper, so the three pure helpers keep taking a real `AgentRun[]`
  // and an unread window can never be handed to a chart as `[]`.
  const windowRuns = overview.windowRuns
  const runsUnread = windowRuns === null

  const projectsTotal = overview.projects.length
  // Only a MEASURED project can be called active or inactive; a project whose
  // team proved no run count is neither, so it leaves BOTH halves of the ratio
  // rather than being counted as quiet. The denominator is therefore the
  // measured population — and the sub-label states the coverage, so the card
  // cannot imply it counted the whole registry.
  const measuredProjectRuns = overview.projects
    .map((project) => project.runsLast24h)
    .filter((runs): runs is number => runs !== null)
  const projectsMeasured = measuredProjectRuns.length
  const projectsWithActivity = measuredProjectRuns.filter((runs) => runs > 0).length

  // COST CARRIES ITS OWN COVERAGE, so the sub-label has FIVE things to say and
  // never the wrong one. `kpis.cost24h` is `Cost24hCoverage | null`:
  //  · measured, full coverage    → the plain provenance line.
  //  · measured, PARTIAL coverage → the denominator, said out loud. The figure
  //    is then a LOWER BOUND (a run whose `costUsd` is null had its cost
  //    unmeasured, not waived), and dollars printed without that disclosure
  //    would imply they cover the window.
  //  · null, run read failed      → why the figure is absent.
  //  · null, window read and empty → no run to cost. Not a free window.
  //  · null, runs present but none priced → nothing to sum from.
  // Aliased once because the value is read four times and `kpis.cost24h.usd`
  // does not narrow across a JSX boundary.
  const cost24h = kpis.cost24h
  const costDetail =
    cost24h !== null
      ? cost24h.measuredRuns < cost24h.totalRuns
        ? `Cost measured on ${cost24h.measuredRuns} of ${cost24h.totalRuns} runs`
        : "Summed over the window's runs"
      : windowRuns === null
        ? RUNS_UNREAD_DETAIL
        : windowRuns.length === 0
          ? 'No run in this window to cost'
          : 'No run in this window carried a measurable cost'

  const trend = windowRuns === null ? null : bucketRunsByStartTime(windowRuns)
  const trendSeries: TrendSeries[] =
    trend === null || trend.xLabels.length === 0
      ? []
      : [
          { key: 'completed', label: 'completed', tone: 'accent', points: trend.completed },
          { key: 'failed', label: 'failed', tone: 'danger', points: trend.failed },
        ]

  const statusCounts = windowRuns === null ? null : countRunsByStatus(windowRuns)
  const agentActivity = windowRuns === null ? null : groupRunsByAgent(windowRuns)
  const projectNameById = new Map(overview.projects.map((project) => [project.id, project.name]))

  const [topAction, ...queuedActions] = overview.actionItems
  const topActionHref = topAction ? resolveConsoleHref(topAction.href) : null

  // BLOCK 4 · recent deliveries. `null` = the delivery-event read failed (the
  // same failure the Action queue already surfaces as its own queue item);
  // `[]` = the read succeeded and no copilot has ever delivered. Never
  // collapsed together — see `RecentDelivery` on `dashboard-overview.ts`.
  const recentDeliveries = overview.recentDeliveries

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Overview"
        description="Agents, projects and delivery signals from the live control plane."
        actions={
          <Button href="/admin/runs" color="accent">
            Open runs <ArrowRightIcon />
          </Button>
        }
      />

      <DegradedBanner messages={overview.dataWarnings} />

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────
          THREE across, never six. Measured in Satoshi — the console's own face,
          not an estimate: the widest figure this band renders ("128 / 256" at
          the 24px figure size) is 116px, and `Indisponible` at the 16px absence
          size is 85px, so a card carrying a gauge needs ≈116+12+56 = 184px of
          INNER width before the card's own `px-4`.
          The content column is 992px at 1280 (1280 − 248 rail − 40 padding).
          Six across left each card 123px of inner width and FIVE across leaves
          157px — both cut the figure, and both cut `Indisponible` down to
          something that reads like a value. Three across gives 290px there and
          213px at `lg` (the tightest desktop rung), so the longest figure and
          the longest absence fit at every width, and the six cards land as two
          clean rows of three instead of one truncated row of six. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {/* "EVERY", said out loud, because this figure and the per-project
            `runs` values in the Projects panel below come from TWO DIFFERENT
            READS and do not have to add up. This one counts `windowRuns` —
            every non-evaluation run in the window, including agents on the
            bench that belong to no project. The project rows sum
            `copilot.health.runsLast24h` over each project's team, which no
            bench agent is part of. See the note on the Projects panel.

            `kpis.runs24h` is `number | null`: `0` is the window read and found
            empty, `null` is the window NOT READ. The second renders
            `Indisponible` and swaps the sub-label, because a count of 0 under
            "Every operational run" is exactly the calm, healthy-looking lie a
            dead backend produces. */}
        <KpiCard
          label="Runs · 24h"
          value={kpis.runs24h === null ? unavailableFigure : kpis.runs24h}
          detail={runsUnread ? RUNS_UNREAD_DETAIL : 'Every operational run, bench included'}
        />

        <KpiCard
          label="Success · 24h"
          value={kpis.success24h === null ? unavailableFigure : `${kpis.success24h}%`}
          detail={runsUnread ? RUNS_UNREAD_DETAIL : 'Terminal runs only'}
          aside={
            <ArcGauge
              value={kpis.success24h}
              max={100}
              // 56, not the 72 default — the same rung `runs-screen` and
              // `projects-screen` already settled on. The 16px it gives back is
              // what keeps the figure beside it clear of the gauge at `lg`,
              // where the card is 213px wide inside its padding.
              size={56}
              // TWO REASONS for a null rate, and the gauge is this card's only
              // voice for a screen reader — so it must not tell the blind
              // operator "no terminal run" when the truth is "nobody read the
              // window". The visible layer makes the same distinction through
              // the sub-label above.
              ariaLabel={
                kpis.success24h !== null
                  ? `Success rate over the last 24 hours: ${kpis.success24h} of 100.`
                  : runsUnread
                    ? 'Success rate over the last 24 hours: the run history could not be read.'
                    : 'Success rate over the last 24 hours: no terminal run, nothing measured.'
              }
            />
          }
        />

        <KpiCard
          label="Executable agents"
          value={executable ? `${executable.now} / ${executable.total}` : unavailableFigure}
          detail="Passing the runtime gates now"
          aside={
            <ArcGauge
              value={executable ? executable.now : null}
              // `max={0}` is a MEASURED empty scale, not a missing one — a
              // freshly-empty registry is `{now: 0, total: 0}` — and
              // `ArcGauge`/`RingGauge` both draw that as a solid, measured track
              // (`scaleMax = max >= 0 ? max : null`), never the dashed
              // never-measured one. No flooring needed here.
              max={executable ? executable.total : 100}
              size={56}
              ariaLabel={
                executable
                  ? `Executable agents: ${executable.now} of ${executable.total}.`
                  : 'Executable agents: no measurement available.'
              }
            />
          }
        />

        {/* THE DENOMINATOR IS THE MEASURED POPULATION, NOT THE REGISTRY.
            `ProjectOverviewItem.runsLast24h` can now say "not measured", and an
            unmeasured project is neither active nor inactive — counting it in
            the total would quietly report it as quiet. So it leaves both halves
            and the sub-label discloses how many projects the ratio covers. When
            projects exist and NONE carries a measured figure the card refuses to
            state a ratio at all: `Indisponible`, over a dashed (unmeasured)
            gauge track. An EMPTY registry still reads `0 / 0` — that is a
            measured nothing, not an absence. */}
        <KpiCard
          label="Projects · active"
          value={
            projectsTotal > 0 && projectsMeasured === 0
              ? unavailableFigure
              : `${projectsWithActivity} / ${projectsMeasured}`
          }
          detail={
            projectsMeasured === projectsTotal
              ? 'With at least one run in the window'
              : `Runs measured for ${projectsMeasured} of ${projectsTotal} projects`
          }
          aside={
            projectsMeasured > 0 ? (
              <ArcGauge
                value={projectsWithActivity}
                max={projectsMeasured}
                size={56}
                ariaLabel={`Projects with activity: ${projectsWithActivity} of ${projectsMeasured} projects carrying a measured run count.`}
              />
            ) : projectsTotal > 0 ? (
              <ArcGauge
                value={null}
                size={56}
                ariaLabel="Projects with activity: no project carries a measured run count."
              />
            ) : undefined
          }
        />

        <KpiCard label="Needs action" value={kpis.needsAction} detail="Operator queue" />

        {/* THE FIGURE AND ITS SUPPORT TRAVEL TOGETHER. `AgentRun.costUsd` is
            nullable and `null` there means the runner could not MEASURE the
            cost (a LangGraph run with no usage payload) — not that the run was
            free. So the data layer hands over `{ usd, measuredRuns, totalRuns }`
            rather than a bare number, and this card prints the denominator
            whenever the two counts differ. Dollars shown without it would be
            the same overstatement in nicer clothes: a lower bound read as a
            total.

            `null` is THREE different absences (dead read · empty window · no
            priced run) and all three render `Indisponible`, never "$0.00".
            `formatUsd` used to return an em dash for a null — punctuation, not
            the word this console uses for "nobody measured this" — which is why
            the null was narrowed here before ever reaching it. It now returns
            the same word (`UNAVAILABLE_LABEL`, one vocabulary), so the two
            paths finally AGREE; the narrowing stays because only the component
            can carry the content-subtle role and the figure-sized class.
            `costDetail` above names which absence it is. */}
        <KpiCard
          label="Cost · 24h"
          value={cost24h === null ? unavailableFigure : formatUsd(cost24h.usd)}
          detail={costDetail}
        />
      </div>

      {/* ── BLOCK 1, continued · platform readiness ─────────────────────────
          Still "état global et preuves disponibles": the KPI band above is
          WHAT the control plane measured, this panel is HOW MUCH of it could
          be read at all. Compact single row, not a tall side rail — the ring
          and the three release-pipeline figures sit side by side instead of
          stacking a panel's whole height for six numbers. */}
      <Section
        title="Platform status"
        description={degraded ? 'Part of the control plane did not answer' : 'Control-plane readiness'}
        className={degraded ? 'border-[var(--state-danger-solid-line)]' : undefined}
      >
        <div className="grid grid-cols-1 gap-4 border-b border-line px-4 py-3 sm:grid-cols-[auto_1fr]">
          <div className="flex items-center gap-3">
            <RingGauge
              value={executable ? executable.now : null}
              max={executable ? executable.total : 100}
              label="Executable agents"
              caption={executable ? `of ${executable.total}` : undefined}
              size={96}
            />
            <p className="max-w-40 text-[11px]/4 text-content-subtle">
              {executable
                ? `${executable.now} of ${executable.total} agents would be accepted for a run right now`
                : 'The executable-agent count could not be read'}
            </p>
          </div>
          <dl className="grid grid-cols-3 divide-x divide-line self-center">
            <div className="min-w-0 px-3">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Ready for manual test
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.readyForManualTest === null ? (
                  <Unavailable className="text-xs/6" />
                ) : (
                  kpis.readyForManualTest
                )}
              </dd>
            </div>
            <div className="min-w-0 px-3">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Sandbox pass rate
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.sandboxPassRate === null ? (
                  <Unavailable className="text-xs/6" />
                ) : (
                  `${kpis.sandboxPassRate}%`
                )}
              </dd>
            </div>
            <div className="min-w-0 px-3">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Average repo fit
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.avgRepoFit === null ? <Unavailable className="text-xs/6" /> : kpis.avgRepoFit}
              </dd>
            </div>
          </dl>
        </div>
        <div className="px-4 py-2.5">
          {degraded ? (
            <DegradedBanner
              title="Sources unavailable"
              messages={overview.dataWarnings}
              className="rounded-none border-0 bg-transparent px-0 py-0"
            />
          ) : (
            // Exactly what an empty `dataWarnings` proves — and no more. Two
            // of the collector's reads fail SOFT without raising a warning, so
            // "every source answered" would be a claim this screen cannot back.
            <StatusDot tone="neutral">No data-source warning reported</StatusDot>
          )}
        </div>
      </Section>

      {/* ── BLOCK 2 · actions opérateur ── BLOCK 3 · agents exécutables et
          bloqués ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section
          title="Action queue"
          description="Highest-priority operator decisions"
          priority="primary"
          scroll="md"
        >
          {overview.actionItems.length === 0 ? (
            <EmptyState
              title="No operator action is pending."
              description="Nothing in the queue for the current window."
            />
          ) : (
            <>
              {/* The top item carries the primary CTA, so its row is NOT a link:
                  an anchor inside an anchor is invalid markup. The button is
                  rendered only when its href resolves to a route this console
                  serves — otherwise the destination stays plain text below. */}
              <PanelRow
                title={topAction.title}
                subtitle={topActionHref === null ? `${topAction.meta} · ${topAction.href}` : topAction.meta}
                trailing={
                  <div className="flex shrink-0 items-center gap-2">
                    <StatusDot tone={actionStatusTone(topAction.status)} className="max-w-24 sm:max-w-32">
                      {topAction.status}
                    </StatusDot>
                    {topActionHref === null ? null : (
                      <Button href={topActionHref} color="accent">
                        {topAction.buttonLabel}
                      </Button>
                    )}
                  </div>
                }
              />
              {queuedActions.map((item) => {
                const href = resolveConsoleHref(item.href)
                return (
                  <PanelRow
                    key={item.id}
                    href={href ?? undefined}
                    title={item.title}
                    subtitle={href === null ? `${item.meta} · ${item.href}` : item.meta}
                    trailing={
                      <StatusDot tone={actionStatusTone(item.status)} className="max-w-24 sm:max-w-32">
                        {item.status}
                      </StatusDot>
                    }
                  />
                )
              })}
            </>
          )}
        </Section>

        {/* PARTIALLY affected by a failed run read, and the split is stated
            rather than smoothed: `Production` and `Blocked` come from OTHER
            reads and still hold, while `Ran · 24h` and the whole busiest-agents
            list come from `windowRuns` and become unavailable together. The
            panel keeps its border — only the two cells that lost their source
            change. */}
        <Section
          title="Agents"
          description={
            runsUnread
              ? 'Executable / blocked counts · window activity could not be read'
              : 'Executable / blocked counts and the busiest agents of the window'
          }
        >
          {/* `px-2.5`, not `px-3`: the last 4px per side the cell needed to hold
              `Indisponible` whole at the narrowest rung this strip ever sees.
              And the VALUE line no longer carries `truncate` — the LABEL still
              does. A clipped label is an inconvenience; a clipped absence is a
              lie, because `Indispo…` reads as a value that was measured. If a
              figure ever outgrows this cell it must overflow visibly rather
              than be quietly cut into something that looks like data. */}
          <dl className="grid grid-cols-3 divide-x divide-line border-b border-line">
            <div className="min-w-0 px-2.5 py-2.5">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Production
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.productionAgents === null ? <Unavailable className="text-xs/6" /> : kpis.productionAgents}
              </dd>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Ran · 24h
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {agentActivity === null ? <Unavailable className="text-xs/6" /> : agentActivity.length}
              </dd>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Blocked
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.blockedDeliveries === null ? (
                  <Unavailable className="text-xs/6" />
                ) : (
                  <span
                    className={
                      kpis.blockedDeliveries > 0 ? 'text-[var(--state-danger-text)]' : undefined
                    }
                  >
                    {kpis.blockedDeliveries}
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <div className={LIST_SCROLL}>
            {agentActivity === null ? (
              // NOT the `EmptyState` below. "No agent ran" is a measurement; an
              // empty list under a dead read is the calm, healthy-looking lie
              // this mission removes. Danger role, flattened into the panel.
              <ErrorState
                title={RUNS_UNREAD_TITLE}
                description="Which agents ran in this window could not be read. The fleet counts above come from another read and still hold."
                className="rounded-none border-0 bg-transparent"
              />
            ) : agentActivity.length === 0 ? (
              <EmptyState
                title="No agent ran in this window."
                description="The fleet counts above still hold."
              />
            ) : (
              agentActivity.map((activity) => (
                <PanelRow
                  key={activity.copilotId}
                  href={`/admin/agents/${activity.copilotId}`}
                  title={<span className="font-mono">{activity.copilotId}</span>}
                  subtitle={projectNameById.get(activity.projectId) ?? activity.projectId}
                  values={[
                    { label: 'runs', value: activity.runs },
                    { label: 'ok', value: activity.completed },
                    {
                      label: 'failed',
                      value:
                        activity.failed > 0 ? (
                          <span className="text-[var(--state-danger-text)]">{activity.failed}</span>
                        ) : (
                          activity.failed
                        ),
                    },
                  ]}
                />
              ))
            )}
          </div>
        </Section>
      </div>

      {/* ── BLOCK 4 · livraisons récentes ── BLOCK 5 · télémétrie ───────────
          Both panels read fields the collector already assembled and had
          nowhere to show: `recentDeliveries` is the whole
          `latestDeliveryByCopilot` map (dashboard-overview.ts), previously
          reduced down to a couple of Action-queue rows and otherwise thrown
          away; `telemetryHealth`/`telemetryReportingAgents`/
          `telemetryRunsMeasured` used to sit inside the old "Platform status"
          `dl`, one line among release-pipeline figures they have nothing to
          do with (a delivery channel is not a release gate). */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section
          title="Recent deliveries"
          description={
            recentDeliveries === null
              ? 'Delivery events could not be read'
              : 'Latest push per agent, newest first'
          }
          scroll="md"
          className={recentDeliveries === null ? 'border-[var(--state-danger-solid-line)]' : undefined}
        >
          {recentDeliveries === null ? (
            <ErrorState
              title="Delivery events unavailable"
              description="The delivery-event table could not be read this round. This is not an empty history — an empty one would say so."
              className="rounded-none border-0 bg-transparent"
            />
          ) : recentDeliveries.length === 0 ? (
            <EmptyState
              title="No delivery has been recorded yet."
              description="A push from any agent will appear here."
            />
          ) : (
            recentDeliveries.map((delivery: RecentDelivery) => (
              <PanelRow
                key={delivery.event.id}
                href={`/admin/agents/${delivery.copilotId}`}
                title={<span className="font-mono">{delivery.copilotId}</span>}
                subtitle={`${delivery.event.targetRepo} · ${formatDeliveryStamp(delivery.event.createdAt)} UTC`}
                trailing={
                  <StatusDot tone={actionStatusTone(delivery.event.status)} className="max-w-24 sm:max-w-32">
                    {delivery.event.status}
                  </StatusDot>
                }
              />
            ))
          )}
        </Section>

        <Section
          title="Runtime telemetry"
          description="Global channel — internal runs, lifecycle events and consumer traffic when reported"
          scroll="lg"
        >
          <dl>
            {/* Channel health, not agent health — see the doctrine header on
                `telemetry-health.ts` and `DashboardOverview.telemetryHealth`.
                `loop_muted` / `not_configured` NEVER render as "agent down";
                the tone is informational. */}
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <dt className="min-w-0 truncate text-[11px]/5 text-content-subtle">Channel status</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {telemetryStatusLabel(overview.telemetryHealth.status)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2">
              <dt className="min-w-0 truncate text-[11px]/5 text-content-subtle">Agents reporting</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {overview.telemetryReportingAgents === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  overview.telemetryReportingAgents
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-2">
              <dt className="min-w-0 truncate text-[11px]/5 text-content-subtle">Runs in feed window</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {overview.telemetryRunsMeasured === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  overview.telemetryRunsMeasured
                )}
              </dd>
            </div>
          </dl>
          {overview.recentTelemetryEvents === null ? (
            <ErrorState
              title="Telemetry events unavailable"
              description="The runtime-telemetry event table could not be read this round."
              className="rounded-none border-0 border-t border-line bg-transparent"
            />
          ) : overview.recentTelemetryEvents.length === 0 ? (
            <EmptyState
              title="No runtime telemetry event has been recorded yet."
              description="Internal runs, lifecycle events and consumer POSTs share this channel when they occur."
              className="rounded-none border-0 border-t border-line bg-transparent"
            />
          ) : (
            overview.recentTelemetryEvents.map((event: RuntimeTelemetryEvent) => {
              const provenance = classifyRuntimeTelemetryProvenance(event)
              return (
              <PanelRow
                key={event.id}
                href={`/admin/agents/${event.agentId}`}
                title={<span className="font-mono">{event.agentId}</span>}
                subtitle={`${telemetryProvenanceLabel(provenance)} · ${event.projectId} · ${event.status}${event.eventType ? ` · ${event.eventType}` : ''} · ${formatDeliveryStamp(event.receivedAt)} UTC`}
                trailing={
                  <StatusDot tone={actionStatusTone(event.status)} className="max-w-24 sm:max-w-32">
                    {event.status}
                  </StatusDot>
                }
              />
              )
            })
          )}
        </Section>
      </div>

      {/* ── BLOCK 6 · activité ── flagship chart · success ring ───────────
          THE PANEL THIS MISSION EXISTS FOR. `TrendChart` draws an honest empty
          plate for a window that WAS read and held nothing — and that plate
          is indistinguishable from a dead read once a failure has been
          flattened into `[]`. So the chart is never reached with an unread
          window: the body is replaced by the failure itself, and the panel
          takes the danger border so the row cannot read as calm. */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(0,1fr)]">
        <Section
          title="Run activity · 24h"
          description={
            runsUnread
              ? 'The 24h run window could not be read'
              : 'Completed and failed runs, bucketed across the observed window (UTC)'
          }
          bodyClassName="px-4 pt-3 pb-2"
          className={runsUnread ? 'border-[var(--state-danger-solid-line)]' : undefined}
        >
          {trend === null ? (
            <ErrorState
              title={RUNS_UNREAD_TITLE}
              description="Nothing can be plotted for this window: the runs were never read. This is not an empty window — an empty one would draw its grid and say so."
              // Flattened onto the panel it already sits inside: the danger
              // role lives on the Section border, so a second box here would
              // only double the chrome.
              className="rounded-none border-0 bg-transparent px-0 py-6"
            />
          ) : trendSeries.length === 0 ? (
            // A read window that held nothing gets the COMPACT placeholder, not
            // a 232px grid drawn around one sentence. An empty plot area the
            // size of a full chart reads as a broken chart, and it is the exact
            // "grande zone noire sans information" this console is removing.
            <NoDataChart
              label="No completed or failed run in this window"
              detail="The window was read and held nothing — start a run from an agent to populate this plot."
            />
          ) : (
            <TrendChart
              series={trendSeries}
              xLabels={trend.xLabels}
              height={232}
              showArea
              emptyMessage="No completed or failed run was recorded in this window."
            />
          )}
        </Section>

        <Section
          title="Success rate · 24h"
          description={
            runsUnread ? 'The 24h run window could not be read' : 'Completed over completed plus failed'
          }
        >
          <div className="flex justify-center px-4 pt-4 pb-3">
            <RingGauge
              value={kpis.success24h}
              max={100}
              label="Success rate over the last 24 hours"
              caption="percent"
              size={168}
            />
          </div>
          <dl className="border-t border-line">
            {RUN_STATUSES.map((status) => (
              <div
                key={status}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5 last:border-b-0"
              >
                <dt className="min-w-0">
                  <StatusDot tone={runStatusTone(status)}>{status}</StatusDot>
                </dt>
                {/* A status nothing produced in a window that WAS read is a
                    measured `0` and stays `0`. An unread window has no count at
                    all — five `0`s here would describe a fleet that never ran. */}
                <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                  {statusCounts === null ? <Unavailable className="text-[11px]/5" /> : statusCounts[status]}
                </dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      {/*
        ── BLOCK 7 · projets ────────────────────────────────────────────────
        PROVENANCE, because two screens must not state the same figure from
        two places without saying which. The `runs` value on each row is
        `ProjectOverviewItem.runsLast24h` — the field the data layer already
        computed (`buildProjectOverview`, dashboard-overview.ts) by summing
        `copilot.health.runsLast24h` over the project's team. It is the SAME
        field `/admin/projects` sums for its own `Runs · 24h` column, so the
        two screens read one source and cannot drift apart arithmetically.
        It is NOT `windowRuns`, which is what the KPI band and the Agents
        panel above count — that read has a different population.

        THE TWO SCREENS NOW AGREE ON ABSENCE TOO. `runsLast24h` is
        `number | null`: the data layer sums only the team members that PROVED
        the metric (`isMeasuredHealth`, the same rule `/admin/projects` applies
        through `sumMeasuredHealth`) and returns `null` when a non-empty team proved
        none. So a project whose team proved nothing renders `Indisponible`
        HERE and `Indisponible` THERE — it used to render `0` here and
        `Indisponible` there, from one field, on two screens. A project with no
        copilot at all still renders a measured `0`: no agent, no run to have
        made.

        COST IS NOW THE SAME CONTRACT — the note that used to sit here said
        `costLast24hUsd` was "still typed `number` and still sums the WHOLE
        team", and that is no longer true. It is `number | null` under the
        SAME `isMeasuredHealth` gate as `runsLast24h`: a measured `0` for a
        project with no copilot, the proven sum when members proved one, and
        `null` when a non-empty team proved none. The `$0.00` an unproven cost
        used to normalise into is gone at the source.

        `/admin/projects` reaches those same three states by its OWN route —
        it receives `Copilot[]` instead of a `DashboardOverview` and applies
        `sumMeasuredHealth`, whose measurement rule is character-for-character
        the data layer's. Same rule, same inputs, same answer; the reason
        there are two copies of it is written at that helper, and collapsing
        them into one client-safe module is the follow-up.

        This row still shows only `active` and `runs`. Adding a cost value is
        a layout decision, not a truth fix, so it is not smuggled in here —
        and the field is no longer a hazard sitting unrendered.
      */}
      <Section title="Projects" description="Team rollup · runs summed from agent health">
        <div className={LIST_SCROLL}>
          {overview.projects.length === 0 ? (
            <EmptyState title="No project is available." />
          ) : (
            overview.projects.map((project) => (
              <PanelRow
                key={project.id}
                href={`/admin/projects/${project.id}/builder`}
                title={project.name}
                subtitle={project.repoFullName ?? 'Repository not configured'}
                values={[
                  { label: 'active', value: `${project.activeCount}/${project.copilotCount}` },
                  {
                    label: 'runs',
                    value:
                      project.runsLast24h === null ? unavailableValue : project.runsLast24h,
                  },
                ]}
              />
            ))
          )}
        </div>
        <div className="border-t border-line px-4 py-2">
          <Button href="/admin/projects" plain className="text-xs">
            All projects <ArrowRightIcon />
          </Button>
        </div>
      </Section>
    </div>
  )
}
