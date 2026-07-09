import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { RunTimeline } from '@/components/agent-ops/run-timeline'
import { Badge } from '@/components/catalyst/badge'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/catalyst/description-list'
import { Link } from '@/components/catalyst/link'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import { getVersion } from '@/lib/agent-mission-control/mock-data'
import type { AgentRun, AgentRunStatus, AgentRunStep, ToolCall } from '@/lib/agent-mission-control/types'

const runStatusConfig: Record<AgentRunStatus, { label: string; color: 'green' | 'rose' | 'amber' | 'blue' }> = {
  completed: { label: 'Completed', color: 'green' },
  failed: { label: 'Failed', color: 'rose' },
  blocked: { label: 'Blocked', color: 'rose' },
  'needs-confirmation': { label: 'Needs confirmation', color: 'amber' },
  running: { label: 'Running', color: 'blue' },
}

/** Run lifecycle badge — always-visible text label, never color alone. */
export function RunStatusBadge({ status }: { status: AgentRunStatus }) {
  const config = runStatusConfig[status]

  return <Badge color={config.color}>{config.label}</Badge>
}

/**
 * Run detail panel — receipt-style header (run id + status), fact list,
 * trace deep-link, then the full step timeline. Server-safe.
 */
export function RunDetailPanel({
  run,
  steps,
  toolCalls,
}: {
  run: AgentRun
  steps: AgentRunStep[]
  toolCalls: ToolCall[]
}) {
  const version = getVersion(run.versionId)
  const toolCallsById: Record<string, ToolCall | undefined> = Object.fromEntries(
    toolCalls.map((call) => [call.id, call])
  )

  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
      <div className="border-b border-zinc-950/5 px-6 py-4 dark:border-white/5">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2 className="font-mono text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">{run.id}</h2>
          <RunStatusBadge status={run.status} />
        </div>
        <p className="mt-1 truncate text-sm text-zinc-500 dark:text-zinc-400">{run.inputSummary}</p>
      </div>

      <div className="px-6 py-5">
        <DescriptionList>
          <DescriptionTerm>User</DescriptionTerm>
          <DescriptionDetails>{run.userLabel}</DescriptionDetails>

          <DescriptionTerm>Started</DescriptionTerm>
          <DescriptionDetails className="font-mono text-sm tabular-nums">
            {formatTimestamp(run.startedAt)}
          </DescriptionDetails>

          <DescriptionTerm>Duration</DescriptionTerm>
          <DescriptionDetails className="font-mono text-sm tabular-nums">
            {formatDurationMs(run.latencyMs)}
            {run.finishedAt === null ? <span className="ml-2 font-sans text-zinc-500">so far</span> : null}
          </DescriptionDetails>

          <DescriptionTerm>Cost</DescriptionTerm>
          <DescriptionDetails className="font-mono text-sm tabular-nums">{formatUsd(run.costUsd)}</DescriptionDetails>

          <DescriptionTerm>Tool calls</DescriptionTerm>
          <DescriptionDetails className="font-mono text-sm tabular-nums">{run.toolCallCount}</DescriptionDetails>

          <DescriptionTerm>Unsafe attempts</DescriptionTerm>
          <DescriptionDetails
            className={clsx(
              'font-mono text-sm tabular-nums',
              run.unsafeAttemptCount > 0 && 'font-semibold text-rose-600 dark:text-rose-400'
            )}
          >
            {run.unsafeAttemptCount}
            {run.unsafeAttemptCount > 0 ? <span className="ml-2 font-sans font-medium">unsafe</span> : null}
          </DescriptionDetails>

          <DescriptionTerm>Version</DescriptionTerm>
          <DescriptionDetails className="font-mono text-sm tabular-nums">
            {version?.label ?? run.versionId}
          </DescriptionDetails>

          <DescriptionTerm>Trace</DescriptionTerm>
          <DescriptionDetails>
            {run.traceUrl ? (
              <Link
                href={run.traceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-400"
              >
                Open in LangSmith
                <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
              </Link>
            ) : (
              <span className="text-xs text-zinc-500">No trace recorded</span>
            )}
          </DescriptionDetails>
        </DescriptionList>

        <div className="mt-6 border-t border-zinc-950/5 pt-6 dark:border-white/5">
          <h3 className="text-sm font-semibold text-zinc-950 dark:text-white">Timeline</h3>
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
