import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { DeliveryLoopCard } from '@/components/agent-ops/delivery-loop-card'
import { SandboxStatusRow, type DeliveryRowData, type SandboxRowData } from '@/components/agent-ops/sandbox-status-row'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { Badge } from '@/components/catalyst/badge'
import {
  DELIVERY_LEVEL_LABELS,
  type AgentDeliveryScorecard,
  type DimensionStatus,
} from '@/lib/agent-mission-control/delivery-scorecard'
import { getDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard-server'
import { getLatestDeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import { getLatestSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'

/** Dimension status → Catalyst badge intensity (meaning carried by the label). */
function statusBadge(status: DimensionStatus): 'zinc' | 'accent' | 'accentStrong' | 'accentSolid' {
  switch (status) {
    case 'pass':
      return 'accent'
    case 'fail':
      return 'accentSolid'
    case 'warn':
      return 'accentStrong'
    default:
      // missing — quiet neutral, the evidence text explains it.
      return 'zinc'
  }
}

/**
 * Delivery Scorecard — a compact, NON-BLOCKING readout that aggregates repo-fit
 * with the run-backed intrinsic signals (tests, benchmark, safety, runtime,
 * tools, gate). It separates "safe" from "delivery ready" from "excellent". The
 * Release Gate stays the only fail-closed control; this is decision support.
 * Server component: fetches the scorecard, renders nothing on absence.
 */
export async function DeliveryScorecardCard({ copilotId }: { copilotId: string }) {
  let card: AgentDeliveryScorecard | null = null
  try {
    card = await getDeliveryScorecard(copilotId)
  } catch {
    return null
  }
  if (!card) return null

  // Latest persisted sandbox verdict (pure DB read, no network run). Null = never run.
  let latestSandbox: SandboxRowData | null = null
  try {
    const report = await getLatestSandboxReport(copilotId)
    if (report) {
      latestSandbox = {
        status: report.status,
        executionMode: report.executionMode,
        sandboxFitScore: report.sandboxFitScore,
        repo: report.repo,
        commit: report.commit,
        createdAt: report.createdAt,
      }
    }
  } catch {
    latestSandbox = null
  }

  // Latest delivery event (PR or direct commit) — pure DB read.
  let latestDelivery: DeliveryRowData | null = null
  try {
    const evt = await getLatestDeliveryEvent(copilotId)
    if (evt) {
      latestDelivery = {
        mode: evt.mode,
        prNumber: evt.prNumber,
        prUrl: evt.prUrl,
        deliveryBranch: evt.deliveryBranch,
        createdAt: evt.createdAt,
      }
    }
  } catch {
    latestDelivery = null
  }

  const levelLabel = DELIVERY_LEVEL_LABELS[card.level]

  const targetLabel = card.target === 'production' ? 'Production version' : 'Candidate version'

  return (
    <AgentSectionCard
      title="Delivery scorecard"
      description={`Repo fit aggregated with the run-backed quality & safety signals — decision support, not a gate. Target: ${targetLabel}.`}
      actions={
        <span className="flex items-center gap-2">
          {card.target === 'production' ? <Badge color="accent">Production</Badge> : null}
          <Badge color={card.status === 'fail' ? 'accentSolid' : card.status === 'warn' ? 'accentStrong' : 'accent'}>
            {levelLabel}
          </Badge>
        </span>
      }
      contentClassName="px-6 py-5"
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <RadialMeter
          value={card.score}
          max={100}
          size={104}
          centerText={String(card.score)}
          caption={levelLabel}
          tone={card.status === 'fail' ? 'accentSolid' : 'accent'}
          ariaLabel={`Delivery score: ${card.score} of 100, ${levelLabel}`}
        />
        <dl className="grid flex-1 grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          {card.dimensions.map((d) => (
            <div key={d.id} className="flex items-baseline justify-between gap-3">
              <dt className="min-w-0 truncate text-sm text-zinc-700 dark:text-zinc-300">{d.label}</dt>
              <dd className="flex shrink-0 items-center gap-2 text-right">
                {d.score !== null ? (
                  <span className="font-mono text-sm tabular-nums text-zinc-950 dark:text-white">{d.score}</span>
                ) : null}
                <Badge color={statusBadge(d.status)}>{d.status}</Badge>
              </dd>
            </div>
          ))}
        </dl>
      </div>

      {/* When the scorecard reflects production but a newer candidate is in
          flight, say so — informational, it does NOT pollute the prod score. */}
      {card.target === 'production' && card.hasDifferentCandidate ? (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">
          A newer candidate version differs from production — score it on the Release tab before shipping it.
        </p>
      ) : null}

      {card.blockers.length > 0 ? (
        <div className="mt-5 border-t border-zinc-950/5 pt-4 dark:border-white/5">
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-400">Blockers</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {card.blockers.map((b) => (
              <li key={b}>
                <Badge color="accentStrong">{b}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {card.warnings.length > 0 ? (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Warnings</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {card.warnings.map((w) => (
              <li key={w}>
                <Badge color="zinc">{w}</Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* An informational warning when the LATEST persisted sandbox failed — the
          scorecard stays non-blocking (this never gates a promotion), but a
          failed in-situ check is worth surfacing. */}
      {latestSandbox?.status === 'failed' ? (
        <p className="mt-4 text-xs text-accent-700 dark:text-accent-400">
          Target repo sandbox: failed — the delivered agent did not pass the target repo&apos;s checks.
        </p>
      ) : null}

      {/* Target-repo sandbox — latest delivery + verdict + on-demand run controls. */}
      <SandboxStatusRow copilotId={copilotId} latest={latestSandbox} delivery={latestDelivery} />

      {/* Delivery loop — deliver→test→fix→redeliver→ready state (read-only assess). */}
      <DeliveryLoopCard copilotId={copilotId} />
    </AgentSectionCard>
  )
}
