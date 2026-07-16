import { Badge } from '@/components/catalyst/badge'
import { assessDeliveryLoop } from '@/lib/agent-mission-control/delivery-loop-server'
import type { DeliveryLoopStatus } from '@/lib/agent-mission-control/delivery-loop'

const STATUS_LABEL: Record<DeliveryLoopStatus, string> = {
  created: 'Created',
  dry_run_passed: 'Dry-run passed',
  execute_running: 'Executing',
  execute_failed: 'Execute failed',
  fixing: 'Fixing',
  redelivered: 'Redelivered',
  ready_for_manual_test: 'Ready for manual test',
  manual_test_requested: 'Manual test requested',
  abandoned: 'Abandoned',
  superseded: 'Superseded',
}

function statusColor(s: DeliveryLoopStatus): 'zinc' | 'accent' | 'accentStrong' {
  if (s === 'ready_for_manual_test') return 'accent'
  if (s === 'execute_failed' || s === 'abandoned') return 'accentStrong'
  return 'zinc'
}

/**
 * Delivery Loop — a compact, read-only readout of where the deliver→test→fix→
 * redeliver loop stands (assessed at render, no side effects). Shows the status,
 * latest PR/sandbox, last failure classification, and the next action. It never
 * runs a sandbox or writes anything; the run controls live in the sandbox row.
 * Renders nothing when there is no loop state (no repo / nothing delivered).
 */
export async function DeliveryLoopCard({ copilotId }: { copilotId: string }) {
  let state: Awaited<ReturnType<typeof assessDeliveryLoop>> = null
  try {
    state = await assessDeliveryLoop(copilotId)
  } catch {
    return null
  }
  // Only surface the loop once there's something to show (a delivery or a sandbox).
  if (!state || (!state.latestDelivery && !state.latestSandbox)) return null

  return (
    <div className="mt-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-zinc-500 dark:text-zinc-400">Delivery loop</span>
          <Badge color={statusColor(state.status)}>{STATUS_LABEL[state.status]}</Badge>
          <span className="text-zinc-500 dark:text-zinc-400">attempt {state.attempts}</span>
        </div>
        {state.latestDelivery?.prUrl ? (
          <a
            href={state.latestDelivery.prUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-accent-700 hover:text-accent-600 dark:text-accent-400"
          >
            Latest PR{state.latestDelivery.prNumber ? ` #${state.latestDelivery.prNumber}` : ''} →
          </a>
        ) : null}
      </div>

      {state.classification ? (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Last failure: <span className="font-mono">{state.classification.failureClass}</span>
          {state.classification.aigentFixable ? ' (Aigent-fixable)' : ' (target-repo — not an agent defect)'} — {state.classification.evidence}
        </p>
      ) : null}

      <p className="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
        <span className="text-zinc-500 dark:text-zinc-400">Next action:</span> {state.nextAction}
      </p>

      {state.status === 'ready_for_manual_test' && state.manualTestMessage ? (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--accent-surface)] p-3 text-xs whitespace-pre-wrap text-zinc-800 ring-1 ring-[var(--accent-line)] dark:text-zinc-200">
          {state.manualTestMessage}
        </pre>
      ) : null}
    </div>
  )
}
