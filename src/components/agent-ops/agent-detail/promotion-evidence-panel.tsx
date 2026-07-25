import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { Text } from '@/components/ui/text'
import type { PromotionCheck, PromotionCheckStatus } from '@/lib/agent-mission-control/promotion-gate'

/**
 * Promotion evidence — the extended promotion gate (release-gate rollup +
 * runtime-executable + tools-resolved-certified + shadow-proof +
 * replay-comparison), read-only.
 *
 * This is NOT a second cockpit: it renders exactly what
 * `evaluatePromotionGate` already computed for the "Promote or roll back"
 * section below it, adding no verdict of its own and no second Promote
 * button. `ReleaseActions` derives `canPromote` purely from the `promote`
 * Capability + candidateVersionId it already receives — it exposes no
 * external override prop to wire a second gate into, so adding an actionable
 * control here would either duplicate the real one or risk disagreeing with
 * it. Evidence only.
 */

const STATUS_LABEL: Record<PromotionCheckStatus, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_CONFIGURED: 'Not configured',
  INSUFFICIENT_EVIDENCE: 'Not measured',
}

/** Same honest-text convention as `CheckStatusText` in release-panel.tsx: the
 * word carries the distinction, the accent dot marks PASS only, and a FAIL
 * is never painted the same as an unmeasured check. */
function PromotionStatusText({ status }: { status: PromotionCheckStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={
          status === 'PASS'
            ? 'size-1.5 rounded-full bg-accent-500'
            : status === 'FAIL'
              ? 'size-1.5 rounded-full bg-[var(--state-danger-solid)]'
              : 'size-1.5 rounded-full ring-1 ring-zinc-400 dark:ring-zinc-500'
        }
      />
      <span
        className={
          status === 'PASS'
            ? 'text-accent-700 dark:text-accent-300'
            : status === 'FAIL'
              ? 'text-[var(--state-danger-text)]'
              : 'text-zinc-500 dark:text-zinc-400'
        }
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

/** The five promotion checks, each with its own real `reason` — never a
 * generic message when the check already produced one. */
export function PromotionChecksList({ checks }: { checks: PromotionCheck[] }) {
  return (
    <ul className="flex max-h-72 flex-col overflow-y-auto">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <span className="text-sm text-zinc-200">{check.label}</span>
            <p className="mt-0.5 text-xs text-zinc-400">{check.reason}</p>
            <p className="mt-0.5 text-[10px] text-zinc-500">{check.sourceOfTruth}</p>
          </div>
          <PromotionStatusText status={check.status} />
        </li>
      ))}
    </ul>
  )
}

/** Shadow experiment evidence — always framed as a simulation, never "LIVE". */
export function ShadowEvidence({
  shadow,
}: {
  shadow: {
    status: string
    candidateVerdict: string | null
    wouldMutateCount: number
    sampledRunCount: number
  } | null
}) {
  if (!shadow) {
    return (
      <EmptyState
        title="No shadow experiment"
        description="No shadow run has been recorded for this candidate. This is not a failure — nobody has run the simulation yet."
      />
    )
  }
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div>
        <dt className={eyebrowClass}>Status</dt>
        <dd className="mt-1 text-sm text-zinc-200">{shadow.status}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Verdict</dt>
        <dd className="mt-1 text-sm text-zinc-200">{shadow.candidateVerdict ?? '—'}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Sampled runs</dt>
        <dd className="mt-1 font-mono text-sm tabular-nums text-white">{shadow.sampledRunCount}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Would-mutate breaches</dt>
        <dd className="mt-1 font-mono text-sm tabular-nums text-white">{shadow.wouldMutateCount}</dd>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <Text className="!mt-0 !text-xs">
          A shadow run replays traffic against the candidate without serving it — nothing here was
          shown to a real consumer.
        </Text>
      </div>
    </dl>
  )
}

/** Replay comparison evidence — verdict, case count, and the divergent cases only. */
export function ReplayEvidence({
  replay,
}: {
  replay: {
    verdict: string | null
    caseCount: number
    divergent: Array<{ comparison: string; note: string }>
  } | null
}) {
  if (!replay) {
    return (
      <EmptyState
        title="No replay comparison"
        description="No replay run has been recorded for this candidate against production."
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className={eyebrowClass}>Verdict</dt>
          <dd className="mt-1 text-sm text-zinc-200">{replay.verdict ?? '—'}</dd>
        </div>
        <div>
          <dt className={eyebrowClass}>Cases replayed</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-white">{replay.caseCount}</dd>
        </div>
        <div>
          <dt className={eyebrowClass}>Divergent cases</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-white">{replay.divergent.length}</dd>
        </div>
      </dl>
      {replay.divergent.length > 0 ? (
        <ul className="flex max-h-56 flex-col overflow-y-auto">
          {replay.divergent.map((entry, i) => (
            <li
              key={i}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2 last:border-0"
            >
              <span className="text-xs text-zinc-300">{entry.note}</span>
              <span className="text-xs text-zinc-500">{entry.comparison}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Text className="!mt-0 !text-xs">No case compared worse or non-deterministic against production.</Text>
      )}
    </div>
  )
}

/** The overall verdict line, same four-word vocabulary as the check statuses. */
export function PromotionOverall({ overall, promotable }: { overall: PromotionCheckStatus; promotable: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Text className="!mt-0 !text-xs">
        {promotable
          ? 'Every extended promotion check passes.'
          : 'The extended promotion checks do not currently permit a promotion.'}
      </Text>
      <PromotionStatusText status={overall} />
    </div>
  )
}
