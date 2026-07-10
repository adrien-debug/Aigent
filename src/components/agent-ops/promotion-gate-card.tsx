import { CheckCircleIcon, ClockIcon, MinusCircleIcon, XCircleIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { Badge } from '@/components/catalyst/badge'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import type { CopilotVersion, PromotionCheck, PromotionCheckId, PromotionGate } from '@/lib/agent-mission-control/types'

/**
 * Mock `observed` strings embed the comparison against the threshold (e.g.
 * "95.0% ≥ 90%") which duplicates the "required ≥ 90%" line below it. Show the
 * observed value only; the required line owns the threshold.
 */
function observedValueOnly(observed: string): string {
  return observed.replace(/\s*[≥≤<>]\s*\S+$/u, '')
}

/**
 * Label groups under the progress bar (ecommerce labeled-progress rhythm):
 * a group tints green only when every check it maps to passes.
 */
const CHECK_GROUPS: { label: string; checkIds: PromotionCheckId[] }[] = [
  { label: 'Tests', checkIds: ['test-pass-rate'] },
  { label: 'Safety', checkIds: ['unsafe-actions', 'unauthorized-routes', 'confirmation-mistakes'] },
  { label: 'Shadow', checkIds: ['shadow-agreement'] },
  { label: 'Approval', checkIds: ['human-approval'] },
]

function groupFullyPassed(checks: PromotionCheck[], checkIds: PromotionCheckId[]): boolean {
  return checkIds.every((id) => checks.some((check) => check.id === id && check.status === 'pass'))
}

const checkStatusConfig: Record<
  PromotionCheck['status'],
  { label: string; badgeColor: 'accent' | 'accentSolid' | 'accentStrong' | 'zinc'; Icon: typeof CheckCircleIcon; iconClassName: string }
> = {
  pass: { label: 'Pass', badgeColor: 'accent', Icon: CheckCircleIcon, iconClassName: 'text-accent-600 dark:text-accent-400' },
  fail: { label: 'Fail', badgeColor: 'accentSolid', Icon: XCircleIcon, iconClassName: 'text-accent-600 dark:text-accent-400' },
  pending: { label: 'Pending', badgeColor: 'accentStrong', Icon: ClockIcon, iconClassName: 'text-accent-600 dark:text-accent-400' },
  waived: { label: 'Waived', badgeColor: 'zinc', Icon: MinusCircleIcon, iconClassName: 'text-zinc-500' },
}

function StatusBanner({ gate, candidateLabel }: { gate: PromotionGate; candidateLabel: string }) {
  const failingCount = gate.checks.filter((check) => check.status === 'fail').length

  if (gate.overallStatus === 'ready') {
    return (
      <div className="-mx-6 -mt-5 border-b border-accent-500/20 bg-accent-500/10 px-6 py-4">
        <div className="flex gap-3">
          <CheckCircleIcon aria-hidden="true" className="size-5 shrink-0 text-accent-600 dark:text-accent-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-accent-800 dark:text-accent-200">Ready to promote</p>
            <p className="mt-1 text-xs text-accent-800/80 dark:text-accent-200/85">
              Every gate check passes — <span className="font-mono tabular-nums">{candidateLabel}</span> can be promoted
              to {gate.targetStage}.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (gate.overallStatus === 'blocked') {
    return (
      <div className="-mx-6 -mt-5 border-b border-accent-500/20 bg-accent-500/10 px-6 py-4">
        <div className="flex gap-3">
          <XCircleIcon aria-hidden="true" className="size-5 shrink-0 text-accent-600 dark:text-accent-400" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-accent-800 dark:text-accent-200">
              Blocked — {failingCount} {failingCount === 1 ? 'check' : 'checks'} failing
            </p>
            <p className="mt-1 text-xs text-accent-800/80 dark:text-accent-200/85">
              <span className="font-mono tabular-nums">{candidateLabel}</span> cannot reach {gate.targetStage} until
              every failing check passes or is explicitly waived.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="-mx-6 -mt-5 border-b border-accent-500/20 bg-accent-500/10 px-6 py-4">
      <div className="flex gap-3">
        <ClockIcon aria-hidden="true" className="size-5 shrink-0 text-accent-600 dark:text-accent-400" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-accent-800 dark:text-accent-200">Awaiting human approval</p>
          <p className="mt-1 text-xs text-accent-800/80 dark:text-accent-200/85">
            All automated checks pass — a sign-off is still required before{' '}
            <span className="font-mono tabular-nums">{candidateLabel}</span> ships to {gate.targetStage}.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * Promotion gate panel: overall status banner, checks progress bar, and the
 * full checklist with observed vs required thresholds. Server-safe.
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
  const progressPct = totalChecks > 0 ? (passedChecks / totalChecks) * 100 : 0

  return (
    <AgentSectionCard
      title="Promotion gate"
      description={`Last evaluated ${formatTimestamp(gate.lastEvaluatedAt)}`}
      actions={
        <>
          <span className="font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">{candidateLabel}</span>
          <Badge color={gate.targetStage === 'production' ? 'accent' : 'zinc'}>target: {gate.targetStage}</Badge>
        </>
      }
      contentClassName="px-6 py-5"
    >
      <StatusBanner gate={gate} candidateLabel={candidateLabel} />

      <div className="mt-6">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">
          Checks passing —{' '}
          <span className="font-mono tabular-nums">
            {passedChecks} of {totalChecks}
          </span>
        </p>
        <div className="mt-6">
          <div
            role="progressbar"
            aria-label="Gate checks passing"
            aria-valuemin={0}
            aria-valuemax={totalChecks}
            aria-valuenow={passedChecks}
            aria-valuetext={`${passedChecks} of ${totalChecks} checks passing`}
            className="overflow-hidden rounded-full bg-zinc-950/10 dark:bg-white/10"
          >
            <div style={{ width: `${progressPct}%` }} className="h-2 rounded-full bg-accent-500" />
          </div>
          <div className="mt-6 hidden grid-cols-4 text-sm font-medium text-zinc-500 sm:grid dark:text-zinc-400">
            {CHECK_GROUPS.map((group, groupIdx) => (
              <div
                key={group.label}
                className={clsx(
                  groupIdx === CHECK_GROUPS.length - 1
                    ? 'text-right'
                    : groupIdx !== 0
                      ? 'text-center'
                      : undefined,
                  groupFullyPassed(gate.checks, group.checkIds) && 'text-accent-600 dark:text-accent-400'
                )}
              >
                {group.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <ul role="list" className="mt-6 divide-y divide-zinc-950/5 dark:divide-white/5">
        {gate.checks.map((check) => {
          const config = checkStatusConfig[check.status]
          return (
            <li key={check.id} className="flex items-start gap-3 py-4 first:pt-0 last:pb-0">
              <config.Icon aria-hidden="true" className={clsx('mt-0.5 size-5 shrink-0', config.iconClassName)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-950 dark:text-white">{check.label}</p>
                  <Badge color={config.badgeColor}>{config.label}</Badge>
                </div>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{check.description}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="font-mono text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                  {observedValueOnly(check.observed)}
                </p>
                <p className="mt-1 font-mono text-xs tabular-nums text-zinc-500">required {check.required}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </AgentSectionCard>
  )
}
