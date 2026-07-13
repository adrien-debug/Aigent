import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import type { CopilotVersion, PromotionCheck, PromotionGate } from '@/lib/agent-mission-control/types'

/**
 * Mock `observed` strings embed the comparison against the threshold (e.g.
 * "95.0% ≥ 90%") which duplicates the "required ≥ 90%" line. Show the observed
 * value only; the "→ required" tail owns the threshold.
 */
function observedValueOnly(observed: string): string {
  return observed.replace(/\s*[≥≤<>]\s*\S+$/u, '')
}

const checkStatusLabel: Record<PromotionCheck['status'], string> = {
  pass: 'Pass',
  fail: 'Fail',
  pending: 'Pending',
  waived: 'Waived',
}

// Accent heat-dot per check status — the LABEL still names the state (doctrine:
// colour is never the sole indicator); the dot adds a scannable intensity cue on
// the same accent ramp. pass = soft accent, pending = mid, fail = solid heat,
// waived = neutral zinc.
const checkStatusDot: Record<PromotionCheck['status'], string> = {
  pass: 'bg-accent-500 dark:bg-accent-400',
  pending: 'bg-accent-300 dark:bg-accent-300',
  fail: 'bg-accent-700 dark:bg-accent-600',
  waived: 'bg-zinc-400 dark:bg-zinc-600',
}

const overallStatusLabel: Record<PromotionGate['overallStatus'], string> = {
  ready: 'Ready',
  blocked: 'Blocked',
  'pending-approval': 'Pending approval',
}

/**
 * Promotion gate panel: a single pass/fail SplitBar meter (passing / pending /
 * failing across one accent ramp) plus a dense two-column checklist — one line
 * per check, plain-text status label + name left, `observed → required` mono
 * right, the description demoted to the row's tooltip. The overall verdict
 * rides a plain-text label in the header (no full-bleed status banner; the
 * KPI band already carries it). Server-safe.
 */
export function PromotionGateCard({
  gate,
  candidateVersion,
}: {
  gate: PromotionGate
  candidateVersion?: CopilotVersion
}) {
  const candidateLabel = candidateVersion?.label ?? gate.candidateVersionId
  const totalChecks = gate.checks.length
  const passedChecks = gate.checks.filter((check) => check.status === 'pass').length
  const pendingChecks = gate.checks.filter((check) => check.status === 'pending').length
  const failingChecks = gate.checks.filter((check) => check.status === 'fail').length
  const statusLabel = overallStatusLabel[gate.overallStatus]

  const caption =
    failingChecks > 0
      ? `${passedChecks} of ${totalChecks} checks passing · ${failingChecks} failing`
      : pendingChecks > 0
        ? `${passedChecks} of ${totalChecks} checks passing · ${pendingChecks} awaiting signal`
        : `${passedChecks} of ${totalChecks} checks passing`

  return (
    <AgentSectionCard
      title="Promotion gate"
      description={`Last evaluated ${formatTimestamp(gate.lastEvaluatedAt)}`}
      actions={
        <>
          <span className="font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">{candidateLabel}</span>
          <span className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{statusLabel}</span>
        </>
      }
      contentClassName="px-6 py-5"
    >
      <SplitBar
        height="md"
        showLegend
        caption={caption}
        segments={[
          { key: 'pass', label: 'Passing', value: passedChecks, tone: 'accent-500' },
          { key: 'pending', label: 'Pending', value: pendingChecks, tone: 'accent-300' },
          { key: 'fail', label: 'Failing', value: failingChecks, tone: 'accent-700' },
        ]}
      />

      <ul role="list" className="mt-6 grid gap-x-8 lg:grid-cols-2">
        {gate.checks.map((check) => {
          const label = checkStatusLabel[check.status]
          return (
            <li
              key={check.id}
              title={check.description}
              className="flex items-center justify-between gap-3 border-t border-zinc-950/5 py-2.5 dark:border-white/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex w-14 shrink-0 items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400">
                  <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${checkStatusDot[check.status]}`} />
                  {label}
                </span>
                <span className="truncate text-sm text-zinc-950 dark:text-white">{check.label}</span>
              </div>
              <p className="shrink-0 font-mono text-xs tabular-nums text-zinc-500">
                <span className="text-zinc-700 dark:text-zinc-300">{observedValueOnly(check.observed)}</span>
                {' → '}
                {check.required}
              </p>
            </li>
          )
        })}
      </ul>
    </AgentSectionCard>
  )
}
