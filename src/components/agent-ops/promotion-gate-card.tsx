import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { SplitBar } from '@/components/agent-ops/widgets/split-bar'
import { Badge } from '@/components/catalyst/badge'
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

const checkStatusConfig: Record<
  PromotionCheck['status'],
  { label: string; badgeColor: 'accent' | 'accentSolid' | 'accentStrong' | 'zinc' }
> = {
  pass: { label: 'Pass', badgeColor: 'accent' },
  fail: { label: 'Fail', badgeColor: 'accentSolid' },
  pending: { label: 'Pending', badgeColor: 'accentStrong' },
  waived: { label: 'Waived', badgeColor: 'zinc' },
}

const statusConfig: Record<PromotionGate['overallStatus'], { label: string; badgeColor: 'accent' | 'accentSolid' | 'accentStrong' }> = {
  ready: { label: 'Ready', badgeColor: 'accent' },
  blocked: { label: 'Blocked', badgeColor: 'accentSolid' },
  'pending-approval': { label: 'Pending approval', badgeColor: 'accentStrong' },
}

/**
 * Promotion gate panel: a single pass/fail SplitBar meter (passing / pending /
 * failing across one accent ramp) plus a dense two-column checklist — one line
 * per check, status Badge + label left, `observed → required` mono right, the
 * description demoted to the row's tooltip. The overall verdict rides a single
 * header Badge (no full-bleed status banner; the KPI band already carries it).
 * Server-safe.
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
  const status = statusConfig[gate.overallStatus]

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
          <Badge color={status.badgeColor}>{status.label}</Badge>
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
          const config = checkStatusConfig[check.status]
          return (
            <li
              key={check.id}
              title={check.description}
              className="flex items-center justify-between gap-3 border-t border-zinc-950/5 py-2.5 dark:border-white/5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <Badge color={config.badgeColor}>{config.label}</Badge>
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
