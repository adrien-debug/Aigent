import clsx from 'clsx'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ThresholdMeter } from '@/components/agent-ops/widgets/threshold-meter'
import { Badge } from '@/components/catalyst/badge'
import { formatDate, formatPercent } from '@/lib/agent-mission-control/format'
import { VERSION_STAGE_LABELS } from '@/lib/agent-mission-control/labels'
import type { CopilotVersion, ShadowExperiment, VersionStage } from '@/lib/agent-mission-control/types'

const experimentStatusConfig: Record<
  ShadowExperiment['status'],
  { label: string; color: 'zinc'; dotClassName: string }
> = {
  running: {
    label: 'Running',
    color: 'zinc',
    dotClassName: 'bg-accent-500 motion-safe:animate-pulse dark:bg-accent-400',
  },
  completed: {
    label: 'Completed',
    color: 'zinc',
    dotClassName: 'bg-zinc-500 dark:bg-zinc-400',
  },
  stopped: {
    label: 'Stopped',
    color: 'zinc',
    dotClassName: 'bg-zinc-600 dark:bg-zinc-500',
  },
}

const stageConfig: Record<VersionStage, { label: string; color: 'accent' | 'zinc' }> = {
  production: { label: VERSION_STAGE_LABELS.production, color: 'accent' },
  beta: { label: VERSION_STAGE_LABELS.beta, color: 'zinc' },
  draft: { label: VERSION_STAGE_LABELS.draft, color: 'zinc' },
  archived: { label: VERSION_STAGE_LABELS.archived, color: 'zinc' },
}

function ExperimentStatusBadge({ status }: { status: ShadowExperiment['status'] }) {
  const config = experimentStatusConfig[status]

  return (
    <Badge color={config.color}>
      <span aria-hidden="true" className={clsx('size-1.5 shrink-0 rounded-full', config.dotClassName)} />
      {config.label}
    </Badge>
  )
}

/** One row of the matchup field grid: role label left, version identity right. */
function VersionRow({
  role,
  version,
  versionId,
}: {
  role: 'Production' | 'Candidate'
  version: CopilotVersion | undefined
  versionId: string
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="pt-0.5 text-xs font-medium tracking-wide text-zinc-500 uppercase">{role}</dt>
      <dd className="min-w-0 text-right">
        <div className="flex items-center justify-end gap-2">
          <span className="truncate font-mono text-sm font-medium text-zinc-950 tabular-nums dark:text-white">
            {version?.label ?? versionId}
          </span>
          {version ? <Badge color={stageConfig[version.stage].color}>{stageConfig[version.stage].label}</Badge> : null}
        </div>
        {version ? <p className="mt-1 truncate font-mono text-xs text-zinc-500">{version.model}</p> : null}
      </dd>
    </div>
  )
}

/**
 * Shadow experiment summary card: candidate version mirrored against
 * production traffic. One card = header + two-column body — the matchup and
 * sampled counts on the left, the agreement-vs-gate ThresholdMeter as the hero
 * on the right. No stepper, no readiness footer: the meter's tick + state line
 * carry the promotion signal that used to be triplicated.
 */
export function ShadowExperimentCard({
  experiment,
  productionVersion,
  candidateVersion,
}: {
  experiment: ShadowExperiment
  productionVersion: CopilotVersion | undefined
  candidateVersion: CopilotVersion | undefined
}) {
  const thresholdText = formatPercent(experiment.agreementThreshold, 0)
  const windowText = experiment.endsAt
    ? `${formatDate(experiment.startedAt)} → ${formatDate(experiment.endsAt)}`
    : `Started ${formatDate(experiment.startedAt)}`

  return (
    <AgentSectionCard
      title={experiment.name}
      description={windowText}
      actions={<ExperimentStatusBadge status={experiment.status} />}
      contentClassName="grid gap-8 px-6 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)] lg:items-center"
    >
      <div>
        {/* Production → candidate matchup, two rows split by a hairline */}
        <dl>
          <VersionRow role="Production" version={productionVersion} versionId={experiment.productionVersionId} />
          <div className="mt-3 border-t border-zinc-950/5 pt-3 dark:border-white/5">
            <VersionRow role="Candidate" version={candidateVersion} versionId={experiment.candidateVersionId} />
          </div>
        </dl>

        {/* Sampled counts as inline stats — whitespace-separated, no box */}
        <div className="mt-6 flex flex-wrap gap-x-10 gap-y-3">
          <div>
            <dt className="text-xs text-zinc-500">Sampled runs</dt>
            <dd className="mt-1 font-mono text-lg font-semibold text-zinc-950 tabular-nums dark:text-white">
              {experiment.sampledRunCount.toLocaleString('en-US')}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-zinc-500">Unsafe proposals</dt>
            <dd
              className={clsx(
                'mt-1 font-mono text-lg font-semibold tabular-nums',
                experiment.unsafeProposalCount > 0
                  ? 'text-accent-600 dark:text-accent-400'
                  : 'text-zinc-950 dark:text-white'
              )}
            >
              {experiment.unsafeProposalCount.toLocaleString('en-US')}
            </dd>
          </div>
        </div>
      </div>

      {/* Agreement hero: big value + threshold-gated meter. Sized to match the
          page H1 (24px) — a stat, not a page title, never outranks the H1. */}
      <div>
        <div className="flex items-baseline justify-between gap-x-4">
          <span className="font-mono text-2xl/8 font-semibold text-zinc-950 tabular-nums dark:text-white">
            {formatPercent(experiment.agreementRate)}
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">agreement</span>
        </div>
        <div className="mt-4">
          <ThresholdMeter
            value={experiment.agreementRate}
            threshold={experiment.agreementThreshold}
            thresholdText={thresholdText}
            label={`Threshold ≥ ${thresholdText}`}
            ariaLabel="Shadow agreement versus promotion threshold"
          />
        </div>
      </div>
    </AgentSectionCard>
  )
}
