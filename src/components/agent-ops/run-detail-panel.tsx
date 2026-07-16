import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { RunTimeline } from '@/components/agent-ops/run-timeline'
import { SurfaceCard, surfaceInsetClass } from '@/components/agent-ops/surface-card'
import { Button } from '@/components/catalyst/button'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import { AGENT_RUN_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRun, AgentRunStatus, AgentRunStep, ToolCall } from '@/lib/agent-mission-control/types'

export function RunStatusText({ status }: { status: AgentRunStatus }) {
  return (
    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{AGENT_RUN_STATUS_LABELS[status]}</span>
  )
}

function Stat({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className={clsx('flex min-w-0 flex-col gap-1 p-3', surfaceInsetClass)}>
      <dt className="text-[10px] font-semibold uppercase tracking-widest text-zinc-500">{label}</dt>
      <dd
        className={clsx(
          'truncate font-mono text-sm',
          emphasis ? 'font-medium text-accent-400' : 'text-white'
        )}
      >
        {value}
      </dd>
    </div>
  )
}

export function RunDetailPanel({
  run,
  steps,
  toolCalls,
  versionLabel,
}: {
  run: AgentRun
  steps: AgentRunStep[]
  toolCalls: ToolCall[]
  versionLabel?: string
}) {
  return (
    <SurfaceCard className="flex h-full flex-col">
      <div className="flex flex-col gap-6 border-b border-white/5 bg-black/20 p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-sm font-semibold text-white">Run Detail</h2>
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-zinc-400">
              <span className="truncate font-mono">{run.id}</span>
              <span aria-hidden="true">&bull;</span>
              <span className="whitespace-nowrap">{formatTimestamp(run.startedAt)}</span>
            </div>
          </div>
          {run.traceUrl && (
            <Button href={run.traceUrl} target="_blank" rel="noreferrer" outline className="shrink-0">
              <ArrowTopRightOnSquareIcon data-slot="icon" aria-hidden="true" />
              Open Trace
            </Button>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Status" value={AGENT_RUN_STATUS_LABELS[run.status]} emphasis={run.status !== 'completed'} />
          <Stat label="Duration" value={formatDurationMs(run.latencyMs)} />
          <Stat label="Cost" value={formatUsd(run.costUsd)} />
          <Stat label="Version" value={versionLabel ?? <span className="text-zinc-500">—</span>} />
        </dl>
      </div>

      <div className="flex-1 p-6 overflow-y-auto no-scrollbar bg-[var(--color-surface-primary)]/30">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-6">Execution Timeline</h3>
        <RunTimeline steps={steps} toolCallsById={Object.fromEntries(toolCalls.map(tc => [tc.id, tc]))} />
      </div>
    </SurfaceCard>
  )
}
