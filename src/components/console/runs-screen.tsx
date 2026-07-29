import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'
import type { RunsPageData } from '@/lib/runs-console/runs-page-data'
import {
  deriveRunsMetrics,
  formatDuration,
  formatPercent,
  formatSuccessFigure,
} from '@/lib/runs-console/runs-metrics'

// Alias paths, not `./charts/…`: `scripts/audit-dead.mjs` proves a component is
// alive by looking for `@/<path>` or a SAME-DIRECTORY `./<basename>`. A relative
// import crossing into a sub-directory matches neither and reads as dead.
import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
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
 * `/admin/runs` — the TABLE screen of the console.
 *
 * SERVER COMPONENT. No `'use client'`, no state, no effect: every figure comes
 * from the `RunsPageData` the route already loaded, and the two gauges are
 * hand-written SVG (`./charts/*`). Nothing here hydrates.
 *
 * IT STAYS A TABLE. Run rows are tabular data — one row per execution, the same
 * seven-plus facts on every one — so they render as dense `<tr>`s with hairline
 * separators and tabular figures, never as cards. The Catalyst `Table` primitive
 * already wraps itself in `overflow-x-auto`, which is what lets the row scroll
 * horizontally on a phone instead of wrapping into an unreadable stack.
 *
 * ONE DERIVATION. Totals, the success rate and the cost come from
 * `deriveRunsMetrics(data.runs)` — the module that owns them — over the SAME
 * array the table renders. No second count is computed in this file, so the band
 * and the rows can never disagree.
 *
 * TRUTH. `successRate` and `costUsd` are `number | null`, and `null` means never
 * measured: it renders the word `Indisponible` (`<Unavailable />`), never 0,
 * never "0%", never a gauge arc drawn at zero length. A MEASURED zero renders 0.
 * No `?? 0` on a metric exists here. Failures are painted with the danger role
 * (`--state-danger-*`) and never with the accent.
 *
 * NO FILTERS ARE RENDERED. The shipped screen had none, and neither the route
 * nor `getRunsPageData()` accepts a filter argument; a select or a search field
 * wired to nothing is a dead control, so none is drawn. Adding real filtering
 * means giving the route a searchParam first.
 */

/* --------------------------------------------------------------- constants */

/** `Indisponible` sized for the big KPI figure slot (`text-2xl` would clip it). */
const unavailableFigure = <Unavailable className="text-base/7" />

/** `Indisponible` sized for a dense table cell. */
const unavailableCell = <Unavailable className="text-[11px]" />

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

/* --------------------------------------------------------------- component */

export function RunsScreen({ data }: { data: RunsPageData }) {
  const metrics = deriveRunsMetrics(data.runs)

  // The gauges need a NUMBER (for arc geometry) where the card needs a
  // STRING. Narrowed ONCE, unrounded (0..100) — the gauges' own centre text
  // and this screen's `formatPercent`/`formatSuccessFigure` now share the
  // ONE precision rule in `runs-metrics.ts` (integer stays integer, else one
  // decimal), so every renderer of this metric prints the same figure for
  // the same rate. Previously the KPI card rounded to one decimal while a
  // stray `Math.round` on the aria label rounded to the whole percent —
  // "83.3%" beside "83" for the identical rate.
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

      {/* ── ROW 1 · KPI band ──────────────────────────────────────────────────
          FIVE cards, not six: measured at 1440 a six-up band leaves ~150px per
          card, and the card carrying the arc gauge then truncates its own figure
          ("Indisponible" clipped to "I..") — a truncated absence reads as a bug.
          Unsafe attempts moved to the outcome panel's footer, where they are
          stated in full; they are also on every row of the table. */}
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

      {/* ── ROW 2 · the table · the outcome ring ──────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section
          title="Run activity"
          description={`${data.runs.length} of ${data.windowRunCount} runs · table capped at ${data.tableRowCap}`}
        >
          <div className={TABLE_SCROLL}>
            {data.runs.length === 0 ? (
              <EmptyState
                title="No operational run was recorded in this window."
                description="The 24h window was read and held nothing."
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
                  {data.runs.map((run) => {
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
