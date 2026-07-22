import { AGENT_RUN_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

/**
 * Tooltip copy for every estimated-cost surface. The run's `costUsd` is a
 * token×list-price ESTIMATE (see `model-pricing.ts`), never a billing-grade
 * figure — the "est." qualifier + this hover make that explicit instead of
 * dressing an approximation up as an invoice.
 */
export const COST_ESTIMATE_TOOLTIP =
  'Estimated cost: input/output tokens × model list price (model-pricing.ts). Approximate, not billing-grade.'

export function RunStatusText({ status }: { status: AgentRunStatus }) {
  return (
    <span className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{AGENT_RUN_STATUS_LABELS[status]}</span>
  )
}
