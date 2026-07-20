import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { RunTimeline } from '@/components/agent-ops/run-timeline'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import { AGENT_RUN_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRun, AgentRunStatus, AgentRunStep, ToolCall } from '@/lib/agent-mission-control/types'

/**
 * Tooltip copy for every estimated-cost surface. The run's `costUsd` is a
 * token×list-price ESTIMATE (see `model-pricing.ts`), never a billing-grade
 * figure — the "est." qualifier + this hover make that explicit instead of
 * dressing an approximation up as an invoice.
 */
export const COST_ESTIMATE_TOOLTIP =
  'Estimated cost: input/output tokens × model list price (model-pricing.ts). Approximate, not billing-grade.'

/**
 * The model that actually RAN, with an "unverified" badge when the runner never
 * proved it (or the run predates the resolved_model column). Falls back to the
 * copilot's declared model only as a labelled last resort — never silently
 * presented as the executed model.
 */
export function RunModelValue({ run, declaredModel }: { run: Pick<AgentRun, 'resolvedModel' | 'modelUnverified'>; declaredModel?: string }) {
  const model = run.resolvedModel ?? declaredModel ?? null
  if (model === null) {
    return <span className="text-zinc-500">Unverified</span>
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span className="truncate">{model}</span>
      {run.modelUnverified ? (
        <Badge color="zinc" className="shrink-0" title="The model that ran was not verified against a proof — treat it as best-effort.">
          unverified
        </Badge>
      ) : null}
    </span>
  )
}

export function RunStatusText({ status }: { status: AgentRunStatus }) {
  return (
    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{AGENT_RUN_STATUS_LABELS[status]}</span>
  )
}

function Stat({
  label,
  value,
  emphasis,
  labelTitle,
}: {
  label: string
  value: React.ReactNode
  emphasis?: boolean
  /** Optional hover copy on the label (e.g. explaining an estimated figure). */
  labelTitle?: string
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt
        className={clsx(
          'text-[10px] font-semibold uppercase tracking-widest text-zinc-500',
          labelTitle && 'cursor-help'
        )}
        title={labelTitle}
      >
        {label}
      </dt>
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
  declaredModel,
}: {
  run: AgentRun
  steps: AgentRunStep[]
  toolCalls: ToolCall[]
  versionLabel?: string
  /** The copilot's declared model — labelled fallback when the run has no resolved model. */
  declaredModel?: string
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-3 pb-6">
        <div>
          <Subheading level={2} tone="neutral" className="tracking-tight text-white">Run Detail</Subheading>
          <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-zinc-400">
            <span className="truncate">{run.id}</span>
            <span aria-hidden="true">&bull;</span>
            <span className="whitespace-nowrap font-sans">{formatTimestamp(run.startedAt)}</span>
          </p>
        </div>
        {run.traceUrl ? (
          <Button href={run.traceUrl} target="_blank" rel="noreferrer" outline className="shrink-0">
            <ArrowTopRightOnSquareIcon data-slot="icon" aria-hidden="true" />
            Open Trace
            <span className="sr-only"> (opens in a new tab)</span>
          </Button>
        ) : null}
      </div>
      
      <div className="pb-8">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
          <Stat label="Status" value={AGENT_RUN_STATUS_LABELS[run.status]} emphasis={run.status !== 'completed'} />
          <Stat label="Model" value={<RunModelValue run={run} declaredModel={declaredModel} />} />
          <Stat label="Duration" value={formatDurationMs(run.latencyMs)} />
          <Stat label="Cost · est." value={formatUsd(run.costUsd)} labelTitle={COST_ESTIMATE_TOOLTIP} />
          <Stat label="Version" value={versionLabel ?? <span className="text-zinc-500">—</span>} />
        </dl>
      </div>

      <div className="flex-1">
        <p className="mb-6 text-[10px] font-semibold uppercase tracking-widest text-zinc-500">
          Execution Timeline
        </p>
        <RunTimeline steps={steps} toolCallsById={Object.fromEntries(toolCalls.map(tc => [tc.id, tc]))} />
      </div>
    </div>
  )
}
