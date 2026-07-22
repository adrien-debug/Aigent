import { Badge } from '@/components/catalyst/badge'
import { AGENT_RUN_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

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
