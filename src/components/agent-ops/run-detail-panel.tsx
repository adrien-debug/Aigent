import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { RunTimeline } from '@/components/agent-ops/run-timeline'
import { SplitBar, type SplitSegment, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import { Subheading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, AgentRunStatus, AgentRunStep, ToolCall } from '@/lib/agent-mission-control/types'

const runStatusLabels: Record<AgentRunStatus, string> = {
  completed: 'Completed',
  failed: 'Failed',
  blocked: 'Blocked',
  'needs-confirmation': 'Needs confirmation',
  running: 'Running',
}

/** Run lifecycle status — plain muted text label, no colored badge. */
export function RunStatusText({ status }: { status: AgentRunStatus }) {
  return <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{runStatusLabels[status]}</span>
}

/**
 * Tool-call outcome ramp — one accent intensity per outcome (severity by fill,
 * never a second hue). Ordered calm → hot so the SplitBar reads as an escalation.
 */
const toolOutcomeRamp: { key: ToolCall['status']; label: string; tone: SplitTone }[] = [
  { key: 'ok', label: 'OK', tone: 'zinc' },
  { key: 'confirmed', label: 'Confirmed', tone: 'accent-400' },
  { key: 'rejected', label: 'Rejected', tone: 'accent-500' },
  { key: 'blocked', label: 'Blocked', tone: 'accent-600' },
  { key: 'error', label: 'Error', tone: 'accent-700' },
]

/** Naked KPI stat — label + big mono value, no box (doctrine: AgentMetricCard rhythm). */
function Stat({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd
        className={clsx(
          'mt-1 font-mono text-base tabular-nums',
          emphasis ? 'font-semibold text-accent-600 dark:text-accent-400' : 'text-zinc-950 dark:text-white'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

/** Tight meta field — stacked label + value, fills its grid cell (no wasted gutter). */
function MetaField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className="mt-1 truncate text-sm text-zinc-700 dark:text-zinc-300">{value}</dd>
    </div>
  )
}

/**
 * Run detail panel — receipt header (run id + status), a dense KPI stat grid,
 * the run's tool-call outcome mix as a SplitBar, a tight meta grid, then the
 * full step timeline. One card, sections split by hairline only (no box-in-box).
 * Server-safe.
 */
export function RunDetailPanel({
  run,
  steps,
  toolCalls,
  versionLabel,
}: {
  run: AgentRun
  steps: AgentRunStep[]
  toolCalls: ToolCall[]
  /** Human label for run.versionId, resolved live by the page (falls back to the id). */
  versionLabel?: string | null
}) {
  const toolCallsById: Record<string, ToolCall | undefined> = Object.fromEntries(
    toolCalls.map((call) => [call.id, call])
  )

  const outcomeCounts = toolCalls.reduce<Record<ToolCall['status'], number>>(
    (acc, call) => {
      acc[call.status] += 1
      return acc
    },
    { ok: 0, error: 0, blocked: 0, confirmed: 0, rejected: 0 }
  )
  const outcomeSegments: SplitSegment[] = toolOutcomeRamp
    .map(({ key, label, tone }) => ({ key, label, value: outcomeCounts[key], tone }))
    .filter((segment) => segment.value > 0)

  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 bg-zinc-950/[0.025] px-6 py-4 dark:border-white/5 dark:bg-white/[0.04]">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <Subheading className="font-mono tabular-nums">{run.id}</Subheading>
          <RunStatusText status={run.status} />
        </div>
        <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">{run.inputSummary}</p>
      </div>

      <div className="px-6 py-5">
        {/* Headline figures — naked stats, both halves of the row earn their width. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <Stat
            label="Duration"
            value={
              <>
                {formatDurationMs(run.latencyMs)}
                {run.finishedAt === null ? (
                  <span className="ml-1.5 font-sans text-xs font-normal text-zinc-500">so far</span>
                ) : null}
              </>
            }
          />
          <Stat label="Cost" value={formatUsd(run.costUsd)} />
          <Stat label="Tool calls" value={run.toolCallCount} />
          <Stat
            label="Unsafe"
            emphasis={run.unsafeAttemptCount > 0}
            value={
              <>
                {run.unsafeAttemptCount}
                {run.unsafeAttemptCount > 0 ? (
                  <span className="ml-1.5 font-sans text-xs font-medium">flagged</span>
                ) : null}
              </>
            }
          />
        </dl>

        {/* Tool-call outcome mix for THIS run — one bar, not disconnected counts.
            When the run made no tool calls, say so plainly (never imply a call
            happened that didn't). */}
        {outcomeSegments.length > 0 ? (
          <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tool-call outcomes</p>
            <div className="mt-3">
              <SplitBar
                height="md"
                segments={outcomeSegments}
                caption={`${toolCalls.length} call${toolCalls.length === 1 ? '' : 's'} in this run`}
              />
            </div>
          </div>
        ) : (
          <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tool calls</p>
            <p className="mt-2 text-sm text-zinc-500">No tool calls recorded for this run.</p>
          </div>
        )}

        {/* Meta — 2-col field grid, stacked label/value, no empty center gutter. */}
        <dl className="mt-6 grid grid-cols-1 gap-x-6 gap-y-4 border-t border-zinc-950/5 pt-6 sm:grid-cols-2 dark:border-white/5">
          <MetaField label="User" value={run.userLabel} />
          <MetaField
            label="Started"
            value={<span className="font-mono tabular-nums">{formatTimestamp(run.startedAt)}</span>}
          />
          <MetaField
            label="Version"
            value={<span className="font-mono tabular-nums">{versionLabel ?? run.versionId}</span>}
          />
          <MetaField
            label="Trace"
            value={
              run.traceUrl ? (
                <Link
                  href={run.traceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-accent-600 hover:text-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-400"
                >
                  Open in LangSmith
                  <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
                </Link>
              ) : (
                <span className="text-zinc-500">No external trace recorded</span>
              )
            }
          />
        </dl>

        <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
          <Subheading level={3}>Timeline</Subheading>
          <p className="mt-1 text-xs text-zinc-500">
            {steps.length} step{steps.length === 1 ? '' : 's'} &middot; {toolCalls.length} tool call
            {toolCalls.length === 1 ? '' : 's'}
          </p>
          <div className="mt-4">
            <RunTimeline steps={steps} toolCallsById={toolCallsById} />
          </div>
        </div>
      </div>
    </section>
  )
}
