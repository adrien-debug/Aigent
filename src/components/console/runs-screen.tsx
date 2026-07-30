import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'
import type { RunsPageData } from '@/lib/runs-console/runs-page-data'
import {
  deriveRunsMetrics,
  formatDuration,
  formatPercent,
  formatSuccessFigure,
} from '@/lib/runs-console/runs-metrics'
import {
  applyRunsFilters,
  DEFAULT_RUNS_FILTERS,
  hasActiveFilters,
  PERIOD_MS,
  RUN_STATUSES,
  RUNS_COSTS,
  RUNS_DURATIONS,
  RUNS_PERIODS,
  type RunsCost,
  type RunsDuration,
  type RunsFilterState,
  type RunsPeriod,
} from '@/lib/runs-console/runs-filters'
import { buildRunsHourlyBuckets } from '@/lib/runs-console/runs-timeseries'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import crossing into a sub-directory matches neither and reads as dead.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import { TrendChart } from '@/components/console/charts/trend-chart'
import {
  DegradedBanner,
  EmptyState,
  KpiCard,
  ScreenHeader,
  Section,
  TABLE_BODY,
  TABLE_HEAD,
  TABLE_NUM,
  TABLE_ROW,
  TABLE_SCROLL,
  TABLE_SHELL,
  Unavailable,
} from './screen-primitives'

/**
 * `/admin/runs` — the observability workspace of the console.
 *
 * SERVER COMPONENT. No `'use client'`, no state, no effect: every figure comes
 * from the `RunsPageData` the route already loaded plus the `RunsFilterState`
 * the route parsed from the URL (`parseRunsFilters`). Filtering is a GET form
 * (`method="get"`) that round-trips through the URL — there is no client JS on
 * this screen, filtering it included.
 *
 * ONE DERIVATION. `applyRunsFilters(data.runs, filters, …)` narrows the loaded
 * array ONCE; the KPI band, the charts, the table and the outcome panel all
 * read that SAME filtered array. No second filtering path, no second count.
 *
 * TRUTH. `successRate` and cost figures are `number | null`, and `null` means
 * never measured: it renders `Indisponible`, never 0, never a fabricated
 * gauge arc or chart point. A MEASURED zero renders 0. Failures are painted
 * with the danger role, never the accent.
 *
 * EMPTY WINDOW ≠ EMPTY FILTER. `data.windowRunCount === 0` means the 24h read
 * itself held nothing — the screen renders compact: KPI band (still real,
 * still `Indisponible` where unmeasured) plus one explanation panel and a link
 * to Agents. No 200-row empty table, no decorative empty donut. A filter that
 * narrows a REAL window down to zero rows is a different, lesser case: the
 * table area says so in place, the rest of the screen (charts, outcome ring)
 * stays up because the window itself is not empty.
 */

/* --------------------------------------------------------------- constants */

/** `Indisponible` sized for the big KPI figure slot (`text-2xl` would clip it). */
const unavailableFigure = <Unavailable className="text-base/7" />

/** `Indisponible` sized for a dense table cell. */
const unavailableCell = <Unavailable className="text-[11px]" />

const STATUS_LABEL: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  running: 'Running',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
}

const PERIOD_LABEL: Record<RunsPeriod, string> = { '1h': 'Last hour', '6h': 'Last 6h', '24h': 'Last 24h' }
const DURATION_LABEL: Record<RunsDuration, string> = {
  lt1s: 'Under 1s',
  '1to10s': '1s – 10s',
  gt10s: 'Over 10s',
}
const COST_LABEL: Record<RunsCost, string> = { measured: 'Measured', unmeasured: 'Not measured' }

/* ----------------------------------------------------------------- helpers */

/** Terminal outcomes get a coloured dot; everything else stays neutral or
 *  pending. A failure is NEVER painted in the accent. */
function tone(status: AgentRunStatus): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

const pad2 = (value: number) => String(value).padStart(2, '0')

/** UTC wall clock from an ISO instant, formatted without a locale so the string
 *  is identical on every server. Every time on this screen says UTC out loud. */
function formatClockUtc(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const date = new Date(ms)
  return `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
}

/** UTC date + minute, for the "read at" disclosure under the table. */
function formatStampUtc(iso: string): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`
}

/** A count that means trouble is drawn in the danger role once it is non-zero;
 *  a measured 0 stays neutral, because 0 failures is not a failure. */
function dangerCount(count: number) {
  return count > 0 ? <span className="text-[var(--state-danger-text)]">{count}</span> : count
}

/** Distinct, defined values of `pick(run)` across `runs`, sorted — the source
 *  of every filter's option list. Never a fixed enum: an id that never ran
 *  never shows up as a choice with nothing behind it. */
function distinctValues(runs: AgentRun[], pick: (run: AgentRun) => string | null | undefined): string[] {
  const set = new Set<string>()
  for (const run of runs) {
    const value = pick(run)
    if (value) set.add(value)
  }
  return [...set].toSorted()
}

/** Native `<select>`, styled to sit beside `Input` without pulling in a
 *  Catalyst `Select` primitive this console does not carry — a GET-form
 *  control local to this one screen, not a shared component. */
function FilterSelect({
  name,
  value,
  options,
  ariaLabel,
}: {
  name: string
  value: string
  options: { value: string; label: string }[]
  ariaLabel: string
}) {
  return (
    <select
      name={name}
      defaultValue={value}
      aria-label={ariaLabel}
      className="block w-full appearance-none rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-white focus:outline-hidden focus-visible:ring-2 focus-visible:ring-accent-500"
    >
      {options.map((option) => (
        <option key={option.value || '__all'} value={option.value} className="bg-zinc-900 text-white">
          {option.label}
        </option>
      ))}
    </select>
  )
}

/* --------------------------------------------------------------- component */

export function RunsScreen({ data, filters = DEFAULT_RUNS_FILTERS }: { data: RunsPageData; filters?: RunsFilterState }) {
  const ctx = { agentNameById: data.agentNameById, projectNameById: data.projectNameById, nowMs: data.nowMs }
  const filteredRuns = applyRunsFilters(data.runs, filters, ctx)
  const metrics = deriveRunsMetrics(filteredRuns)
  const filtersActive = hasActiveFilters(filters)

  // The gauges need a NUMBER (for arc geometry) where the card needs a
  // STRING. Narrowed ONCE, unrounded (0..100) — the gauges' own centre text
  // and this screen's `formatPercent`/`formatSuccessFigure` now share the
  // ONE precision rule in `runs-metrics.ts` (integer stays integer, else one
  // decimal), so every renderer of this metric prints the same figure for
  // the same rate.
  const successPercent = metrics.successRate === null ? null : metrics.successRate * 100

  /** Every status of the vocabulary, in outcome order. The counts are MEASURED,
   *  so a status nothing produced legitimately renders 0. The words are the raw
   *  `AgentRunStatus` enum values — data, not a second display vocabulary. */
  const outcomes: { status: AgentRunStatus; count: number }[] = [
    { status: 'completed', count: metrics.completed },
    { status: 'failed', count: metrics.failed },
    { status: 'blocked', count: metrics.blocked },
    { status: 'needs-confirmation', count: metrics.needsConfirmation },
    { status: 'running', count: metrics.running },
  ]

  // A SECONDARY read failed: the rows are still real, the labels are not all
  // resolvable. Reported in the danger role — a partial answer must not look
  // healthy — and never confused with the run stream itself failing, which
  // throws in `getRunsPageData` and never reaches this component.
  const degradedMessages =
    data.degraded.length === 0
      ? []
      : [
          `Label sources unavailable: ${data.degraded.join(', ')}. Run rows remain real and unresolved identifiers are shown unchanged.`,
          ...(data.degradedDetail === null ? [] : [data.degradedDetail]),
        ]

  const readAt = formatStampUtc(data.nowIso)

  /* ------------------------------------------------------- empty window ---
   * The 24h read itself held nothing. No table, no donut — one compact panel
   * with the explanation and a real destination, plus the KPI band (still a
   * true reading, still `Indisponible` where nothing was measured). */
  if (data.windowRunCount === 0) {
    return (
      <div className="space-y-4">
        <ScreenHeader
          title="Runs"
          description="Operational executions from the last 24 hours."
          actions={
            <Button href="/admin" outline>
              Back to overview
            </Button>
          }
        />

        <DegradedBanner title="Labels partially unavailable" messages={degradedMessages} />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Runs shown" value={0} detail="0 in the 24h window" />
          <KpiCard
            label="Success"
            value={unavailableFigure}
            detail="0 terminal runs"
            aside={<ArcGauge value={null} max={100} size={56} ariaLabel="Success rate: no run reached a terminal state, nothing measured." />}
          />
          <KpiCard label="Measured cost" value={unavailableFigure} detail="0 of 0 runs measured" />
        </div>

        <Section title="No operational run in this window">
          <EmptyState
            title="No agent produced an operational run in the last 24 hours."
            description="The window was read and held nothing — this is not a read failure. Start a run from an agent to populate this screen."
            className="py-14"
          />
          <div className="border-t border-line px-4 py-3">
            <Button href="/admin/agents">Go to Agents</Button>
          </div>
        </Section>
      </div>
    )
  }

  /* --------------------------------------------------------- filter form --
   * GET form, no client JS: the option lists are built from the RUNS ACTUALLY
   * LOADED (`data.runs`, pre-filter) so a choice is never offered with nothing
   * behind it. Submitting re-requests this same route with a new querystring;
   * `parseRunsFilters` in `page.tsx` reads it back. */
  const agentIds = distinctValues(data.runs, (run) => run.copilotId)
  const projectIds = distinctValues(data.runs, (run) => run.projectId)
  const providers = distinctValues(data.runs, (run) => run.resolvedProvider)
  const models = distinctValues(data.runs, (run) => run.resolvedModel)

  const spanMs = PERIOD_MS[filters.period]
  const buckets = buildRunsHourlyBuckets(filteredRuns, data.nowMs, spanMs)

  return (
    <div className="space-y-4">
      <ScreenHeader
        title="Runs"
        description="Operational executions from the last 24 hours."
        actions={
          <Button href="/admin" outline>
            Back to overview
          </Button>
        }
      />

      <DegradedBanner title="Labels partially unavailable" messages={degradedMessages} />

      {/* ── Filters ─────────────────────────────────────────────────────────
          Only dimensions the loaded data actually carries. `internal/external`
          and `telemetry source` are NOT here: `AgentRun` has no such field, and
          a select bound to nothing is a dead control. */}
      <Section title="Filters" description={filtersActive ? 'Narrowed view — clear to see every loaded run.' : 'All loaded runs shown.'}>
        <form method="get" className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="flex min-w-32 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Search</span>
            <Input name="q" type="search" defaultValue={filters.q} placeholder="id, agent, project…" />
          </label>

          <label className="flex w-36 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Status</span>
            <FilterSelect
              name="status"
              value={filters.status}
              ariaLabel="Filter by status"
              options={[{ value: '', label: 'All statuses' }, ...RUN_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))]}
            />
          </label>

          <label className="flex w-40 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Agent</span>
            <FilterSelect
              name="agent"
              value={filters.agent}
              ariaLabel="Filter by agent"
              options={[
                { value: '', label: 'All agents' },
                ...agentIds.map((id) => ({ value: id, label: data.agentNameById.get(id) ?? id })),
              ]}
            />
          </label>

          <label className="flex w-40 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Project</span>
            <FilterSelect
              name="project"
              value={filters.project}
              ariaLabel="Filter by project"
              options={[
                { value: '', label: 'All projects' },
                ...projectIds.map((id) => ({ value: id, label: data.projectNameById.get(id) ?? id })),
              ]}
            />
          </label>

          <label className="flex w-32 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Period</span>
            <FilterSelect
              name="period"
              value={filters.period}
              ariaLabel="Filter by period"
              options={RUNS_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
            />
          </label>

          <label className="flex w-32 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Duration</span>
            <FilterSelect
              name="duration"
              value={filters.duration}
              ariaLabel="Filter by duration"
              options={[{ value: '', label: 'Any duration' }, ...RUNS_DURATIONS.map((d) => ({ value: d, label: DURATION_LABEL[d] }))]}
            />
          </label>

          <label className="flex w-32 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Cost</span>
            <FilterSelect
              name="cost"
              value={filters.cost}
              ariaLabel="Filter by cost measurement"
              options={[{ value: '', label: 'Any cost' }, ...RUNS_COSTS.map((c) => ({ value: c, label: COST_LABEL[c] }))]}
            />
          </label>

          <label className="flex w-36 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Provider</span>
            <FilterSelect
              name="provider"
              value={filters.provider}
              ariaLabel="Filter by provider"
              options={[{ value: '', label: 'All providers' }, ...providers.map((p) => ({ value: p, label: p }))]}
            />
          </label>

          <label className="flex w-40 flex-col gap-1">
            <span className="text-[10px] uppercase tracking-widest text-zinc-500">Model</span>
            <FilterSelect
              name="model"
              value={filters.model}
              ariaLabel="Filter by model"
              options={[{ value: '', label: 'All models' }, ...models.map((m) => ({ value: m, label: m }))]}
            />
          </label>

          <div className="flex items-center gap-2">
            <Button type="submit">Apply</Button>
            {filtersActive ? (
              <Button href="/admin/runs" outline>
                Clear
              </Button>
            ) : null}
          </div>
        </form>
      </Section>

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <KpiCard
          label="Runs shown"
          value={metrics.total}
          detail={`${data.windowRunCount} in the 24h window`}
        />

        <KpiCard label="Running" value={metrics.running} detail="Currently executing" />

        <KpiCard
          label="Success"
          value={metrics.successRate === null ? unavailableFigure : formatPercent(metrics.successRate)}
          detail={`${metrics.terminal} terminal run${metrics.terminal === 1 ? '' : 's'}`}
          aside={
            <ArcGauge
              value={successPercent}
              max={100}
              // 56, not the 72 default: at five cards across 1440 the card is
              // ~220px, and a 72px gauge squeezes the figure beside it until
              // "Indisponible" truncates. Measured, not guessed.
              size={56}
              ariaLabel={
                metrics.successRate === null
                  ? 'Success rate: no run reached a terminal state, nothing measured.'
                  : `Success rate: ${formatSuccessFigure(metrics.successRate)} of 100.`
              }
            />
          }
        />

        <KpiCard
          label="Failed"
          value={dangerCount(metrics.failed)}
          detail={`${metrics.blocked} blocked`}
        />

        <KpiCard
          label="Measured cost"
          value={metrics.measuredCostUsd === null ? unavailableFigure : formatUsd(metrics.measuredCostUsd)}
          detail={`${metrics.measuredCostRuns} of ${metrics.total} runs measured`}
        />
      </div>

      {/* ── ROW 2 · charts ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section title="Runs over time" description="Hourly count, filtered runs">
          <div className="px-4 py-4">
            <TrendChart
              series={[{ key: 'runs', label: 'Runs', tone: 'accent', points: buckets.runsPerHour }]}
              xLabels={buckets.xLabels}
              showArea
            />
          </div>
        </Section>

        <Section title="Success / failed / blocked" description="Hourly outcome counts">
          <div className="px-4 py-4">
            <TrendChart
              series={[
                { key: 'completed', label: 'Completed', tone: 'accent', points: buckets.completedPerHour },
                { key: 'failed', label: 'Failed', tone: 'danger', points: buckets.failedPerHour },
                { key: 'blocked', label: 'Blocked', tone: 'muted', points: buckets.blockedPerHour },
              ]}
              xLabels={buckets.xLabels}
            />
          </div>
        </Section>

        <Section title="Latency" description="Average and p95, milliseconds">
          <div className="px-4 py-4">
            <TrendChart
              series={[
                { key: 'avg', label: 'Avg', tone: 'accent', points: buckets.avgLatencyMsPerHour },
                { key: 'p95', label: 'P95', tone: 'muted', points: buckets.p95LatencyMsPerHour },
              ]}
              xLabels={buckets.xLabels}
              emptyMessage="No run measured a latency in this window."
            />
          </div>
        </Section>

        <Section title="Measured cost" description="Hourly sum, USD">
          <div className="px-4 py-4">
            <TrendChart
              series={[{ key: 'cost', label: 'Cost (USD)', tone: 'accent', points: buckets.costUsdPerHour }]}
              xLabels={buckets.xLabels}
              showArea
              emptyMessage="No run measured a cost in this window."
            />
          </div>
        </Section>

        <Section title="Tool calls & errors" description="Hourly tool-call count vs. failed/blocked runs" className="lg:col-span-2">
          <div className="px-4 py-4">
            <TrendChart
              series={[
                { key: 'tools', label: 'Tool calls', tone: 'muted', points: buckets.toolCallsPerHour },
                { key: 'errors', label: 'Errors', tone: 'danger', points: buckets.errorsPerHour },
              ]}
              xLabels={buckets.xLabels}
            />
          </div>
        </Section>
      </div>

      {/* ── ROW 3 · the table · the outcome ring ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section
          title="Run activity"
          description={`${filteredRuns.length} of ${data.runs.length} loaded runs shown · table capped at ${data.tableRowCap}`}
        >
          <div className={TABLE_SCROLL}>
            {filteredRuns.length === 0 ? (
              <EmptyState
                title={filtersActive ? 'No run matches the current filters.' : 'No operational run was recorded in this window.'}
                description={
                  filtersActive
                    ? 'The 24h window holds runs, but none match this combination — try clearing a filter.'
                    : 'The 24h window was read and held nothing.'
                }
              />
            ) : (
              <Table caption="Operational run activity" className={TABLE_SHELL}>
                <TableHead className={TABLE_HEAD}>
                  <TableRow className={TABLE_ROW}>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Agent</TableHeader>
                    <TableHeader>Project</TableHeader>
                    <TableHeader>Model</TableHeader>
                    <TableHeader className={TABLE_NUM}>Tools</TableHeader>
                    <TableHeader className={TABLE_NUM}>Latency</TableHeader>
                    <TableHeader className={TABLE_NUM}>Cost</TableHeader>
                    <TableHeader className={TABLE_NUM}>Started · UTC</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody className={TABLE_BODY}>
                  {filteredRuns.map((run) => {
                    // An unresolved label falls back to the IDENTIFIER, in mono
                    // so it reads as the id it is — never a fabricated name.
                    const agentName = data.agentNameById.get(run.copilotId)
                    const projectName = data.projectNameById.get(run.projectId)
                    const startedAt = formatClockUtc(run.startedAt)
                    const latency = formatDuration(run.latencyMs)

                    return (
                      // No cell in a run row carries a destination, so the row
                      // stays inert: a hover highlight here would advertise a
                      // drill-through that does not exist.
                      <TableRow key={run.id} className={TABLE_ROW}>
                        <TableCell>
                          <StatusDot tone={tone(run.status)}>{run.status}</StatusDot>
                        </TableCell>

                        <TableCell className="text-white">
                          <p className="max-w-52 truncate">
                            {agentName ?? <span className="font-mono text-zinc-400">{run.copilotId}</span>}
                          </p>
                        </TableCell>

                        <TableCell className="text-zinc-400">
                          <p className="max-w-40 truncate">
                            {projectName ?? <span className="font-mono">{run.projectId}</span>}
                          </p>
                        </TableCell>

                        <TableCell className="text-zinc-400">
                          {run.modelUnverified ? (
                            <span className="text-zinc-500">unverified</span>
                          ) : run.resolvedModel ? (
                            <span className="font-mono text-[11px]">{run.resolvedModel}</span>
                          ) : (
                            unavailableCell
                          )}
                        </TableCell>

                        <TableCell className={TABLE_NUM}>
                          <span className="text-zinc-300">{run.toolCallCount}</span>
                          {run.unsafeAttemptCount > 0 ? (
                            <span className="ml-1.5 text-[11px] text-[var(--state-danger-text)]">
                              +{run.unsafeAttemptCount} unsafe
                            </span>
                          ) : null}
                        </TableCell>

                        <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                          {latency ?? unavailableCell}
                        </TableCell>

                        <TableCell className={`${TABLE_NUM} text-zinc-300`}>
                          {run.costUsd === null ? unavailableCell : formatUsd(run.costUsd)}
                        </TableCell>

                        <TableCell className={`${TABLE_NUM} text-zinc-400`}>
                          {startedAt === null ? (
                            unavailableCell
                          ) : (
                            <time dateTime={run.startedAt}>{startedAt}</time>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {/* Disclosures, outside the scroll area so they never scroll away:
              when the window read itself hit its cap, the ROW COUNT above is a
              floor rather than a total, and saying so is the difference between
              a cap and a lie. */}
          <div className="border-t border-line px-4 py-2">
            <p className="text-[11px]/4 text-zinc-500">
              {readAt === null ? 'Read time unavailable' : `Read at ${readAt}`}
              {data.windowTruncated ? ` · window read capped at ${data.windowMaxRows} rows` : ''}
            </p>
          </div>
        </Section>

        <Section title="Outcome mix" description="Across the runs rendered on the left">
          <div className="flex justify-center px-4 pt-4 pb-3">
            <RingGauge
              value={successPercent}
              max={100}
              label="Success rate across the rendered runs"
              caption="percent"
              size={168}
            />
          </div>

          <dl className="border-t border-line">
            {outcomes.map((outcome) => (
              <div
                key={outcome.status}
                className="flex items-center justify-between gap-3 border-b border-line px-4 py-1.5 last:border-b-0"
              >
                <dt className="min-w-0">
                  <StatusDot tone={tone(outcome.status)}>{outcome.status}</StatusDot>
                </dt>
                <dd className="shrink-0 text-[13px]/5 tabular-nums text-white">{outcome.count}</dd>
              </div>
            ))}
          </dl>

          <div className="border-t border-line px-4 py-2">
            <p className="text-[11px]/4 text-zinc-500">
              {metrics.unmeasuredCostRuns} run{metrics.unmeasuredCostRuns === 1 ? '' : 's'} carried no
              measured cost ·{' '}
              {metrics.unsafeAttemptRuns > 0 ? (
                <span className="text-[var(--state-danger-text)]">
                  {metrics.unsafeAttemptRuns} with a blocked tool attempt
                </span>
              ) : (
                '0 with a blocked tool attempt'
              )}
            </p>
          </div>
        </Section>
      </div>
    </div>
  )
}
