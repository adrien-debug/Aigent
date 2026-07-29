import { ArrowRightIcon } from '@heroicons/react/20/solid'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import that crosses into a sub-directory matches neither, so these three files
// read as dead components and the gate goes red.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import { TrendChart, type TrendSeries } from '@/components/console/charts/trend-chart'
import {
  DegradedBanner,
  EmptyState,
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

/** UTC wall clock, formatted from the epoch without a locale so the label is
 *  identical on every server. The chart header says UTC out loud. */
function formatClockUtc(epochMs: number): string {
  const date = new Date(epochMs)
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`
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

  const projectsTotal = overview.projects.length
  const projectsWithActivity = overview.projects.filter((project) => project.runsLast24h > 0).length

  const trend = bucketRunsByStartTime(overview.windowRuns)
  const trendSeries: TrendSeries[] =
    trend.xLabels.length === 0
      ? []
      : [
          { key: 'completed', label: 'completed', tone: 'accent', points: trend.completed },
          { key: 'failed', label: 'failed', tone: 'danger', points: trend.failed },
        ]

  const statusCounts = countRunsByStatus(overview.windowRuns)
  const agentActivity = groupRunsByAgent(overview.windowRuns)
  const projectNameById = new Map(overview.projects.map((project) => [project.id, project.name]))

  const [topAction, ...queuedActions] = overview.actionItems
  const topActionHref = topAction ? resolveConsoleHref(topAction.href) : null

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
            READS and do not have to add up. This one is `windowRuns.length` —
            every non-evaluation run in the window, including agents on the
            bench that belong to no project. The project rows sum
            `copilot.health.runsLast24h` over each project's team, which no
            bench agent is part of. See the note on the Projects panel. */}
        <KpiCard label="Runs · 24h" value={kpis.runs24h} detail="Every operational run, bench included" />

        <KpiCard
          label="Success · 24h"
          value={kpis.success24h === null ? unavailableFigure : `${kpis.success24h}%`}
          detail="Terminal runs only"
          aside={
            <ArcGauge
              value={kpis.success24h}
              max={100}
              // 56, not the 72 default — the same rung `runs-screen` and
              // `projects-screen` already settled on. The 16px it gives back is
              // what keeps the figure beside it clear of the gauge at `lg`,
              // where the card is 213px wide inside its padding.
              size={56}
              ariaLabel={
                kpis.success24h === null
                  ? 'Success rate over the last 24 hours: no terminal run, nothing measured.'
                  : `Success rate over the last 24 hours: ${kpis.success24h} of 100.`
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

        <KpiCard
          label="Projects · active"
          value={`${projectsWithActivity} / ${projectsTotal}`}
          detail="With at least one run in the window"
          aside={
            projectsTotal > 0 ? (
              <ArcGauge
                value={projectsWithActivity}
                max={projectsTotal}
                size={56}
                ariaLabel={`Projects with activity: ${projectsWithActivity} of ${projectsTotal}.`}
              />
            ) : undefined
          }
        />

        <KpiCard label="Needs action" value={kpis.needsAction} detail="Operator queue" />

        <KpiCard
          label="Cost · 24h"
          value={kpis.cost24h === null ? unavailableFigure : formatUsd(kpis.cost24h)}
          detail="Summed over the window's runs"
        />
      </div>

      {/* ── ROW 2 · queue · flagship chart · success ring ───────────────── */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.8fr)_minmax(0,0.9fr)]">
        <Section
          title="Action queue"
          description="Highest-priority operator decisions"
          scroll="md"
          className="md:col-start-1 md:row-start-1 xl:col-start-1 xl:row-start-1"
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

        <Section
          title="Run activity · 24h"
          description="Completed and failed runs, bucketed across the observed window (UTC)"
          bodyClassName="px-4 pt-3 pb-2"
          className="md:col-span-2 md:row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1"
        >
          <TrendChart
            series={trendSeries}
            xLabels={trend.xLabels}
            height={232}
            showArea
            emptyMessage="No completed or failed run was recorded in this window."
          />
        </Section>

        <Section
          title="Success rate · 24h"
          description="Completed over completed plus failed"
          className="md:col-start-2 md:row-start-1 xl:col-start-3 xl:row-start-1"
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
                <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">{statusCounts[status]}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      {/* ── ROW 3 · agents · projects · platform ──────────────────────────
          The middle track is 1.2fr, not 1.5fr. Same measured reason as the KPI
          band: at 1280 the old split gave the side panels 274px, and the Agents
          panel spends its width on a THREE-UP stat strip — 91px per cell, 67px
          inside the cell padding, against a 76px `PRODUCTION` label and a 64px
          `Indisponible`. Both were cut. At 1.2fr the side panels are 300px, the
          cell holds 79px, and the two longest strings fit. The Projects list in
          the middle gives up 51px it was spending on a title that truncates
          either way. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)]">
        <Section
          title="Agents"
          description="Fleet counts and the busiest agents of the window"
          className="md:col-start-1 md:row-start-1 xl:col-start-1 xl:row-start-1"
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
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">
                Production
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">
                {kpis.productionAgents === null ? <Unavailable className="text-xs/6" /> : kpis.productionAgents}
              </dd>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">
                Ran · 24h
              </dt>
              <dd className="mt-1 text-lg/6 tabular-nums text-white">{agentActivity.length}</dd>
            </div>
            <div className="min-w-0 px-2.5 py-2.5">
              <dt className="truncate text-[10px]/4 font-semibold uppercase tracking-widest text-zinc-500">
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
            {agentActivity.length === 0 ? (
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

        {/*
          PROVENANCE, because two screens must not state the same figure from
          two places without saying which. The `runs` value on each row is
          `ProjectOverviewItem.runsLast24h` — the field the data layer already
          computed (`buildProjectOverview`, dashboard-overview.ts) by summing
          `copilot.health.runsLast24h` over the project's team. It is the SAME
          field `/admin/projects` sums for its own `Runs · 24h` column, so the
          two screens read one source and cannot drift apart arithmetically.
          It is NOT `windowRuns`, which is what the KPI band and the Agents
          panel above count — that read has a different population.

          ONE DIFFERENCE REMAINS AND IT IS NOT FIXABLE FROM THIS FILE: this
          field is typed `number`, so a project whose team proved NOTHING
          arrives here as `0`, while `/admin/projects` renders `Indisponible`
          for it (`sumMeasured` consults `healthUnavailableFields`, which this
          contract does not carry). Closing that needs `ProjectOverviewItem` to
          be able to say "not measured" — a change in src/lib, out of this
          mission's scope, and reported rather than made silently.
        */}
        <Section
          title="Projects"
          description="Team rollup · runs summed from agent health"
          className="md:col-span-2 md:row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1"
        >
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
                    { label: 'runs', value: project.runsLast24h },
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

        <Section
          title="Platform status"
          description={
            degraded ? 'Part of the control plane did not answer' : 'Control-plane readiness'
          }
          className={
            degraded
              ? 'border-[var(--state-danger-solid-line)] md:col-start-2 md:row-start-1 xl:col-start-3 xl:row-start-1'
              : 'md:col-start-2 md:row-start-1 xl:col-start-3 xl:row-start-1'
          }
        >
          <div className="flex flex-col items-center px-4 pt-4 pb-3">
            <RingGauge
              value={executable ? executable.now : null}
              max={executable ? executable.total : 100}
              label="Executable agents"
              caption={executable ? `of ${executable.total}` : undefined}
              size={168}
            />
            <p className="mt-2 text-center text-[11px]/4 text-zinc-500">
              {executable
                ? `${executable.now} of ${executable.total} agents would be accepted for a run right now`
                : 'The executable-agent count could not be read'}
            </p>
          </div>

          <div className="border-t border-line px-4 py-2.5">
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
              <StatusDot tone="positive">No data-source warning reported</StatusDot>
            )}
          </div>

          <dl className="border-t border-line">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5">
              <dt className="min-w-0 truncate text-[11px]/5 text-zinc-500">Ready for manual test</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {kpis.readyForManualTest === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  kpis.readyForManualTest
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5">
              <dt className="min-w-0 truncate text-[11px]/5 text-zinc-500">Sandbox pass rate</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {kpis.sandboxPassRate === null ? (
                  <Unavailable className="text-[11px]/5" />
                ) : (
                  `${kpis.sandboxPassRate}%`
                )}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-1.5">
              <dt className="min-w-0 truncate text-[11px]/5 text-zinc-500">Average repo fit</dt>
              <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">
                {kpis.avgRepoFit === null ? <Unavailable className="text-[11px]/5" /> : kpis.avgRepoFit}
              </dd>
            </div>
          </dl>
        </Section>
      </div>
    </div>
  )
}
