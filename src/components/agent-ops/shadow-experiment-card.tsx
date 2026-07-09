import { CheckCircleIcon, ExclamationTriangleIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { formatDate, formatPercent } from '@/lib/agent-mission-control/format'
import type { CopilotVersion, ShadowExperiment, VersionStage } from '@/lib/agent-mission-control/types'

const experimentStatusConfig: Record<
  ShadowExperiment['status'],
  { label: string; color: 'blue' | 'zinc'; dotClassName: string }
> = {
  running: {
    label: 'Running',
    color: 'blue',
    dotClassName: 'bg-blue-500 motion-safe:animate-pulse dark:bg-blue-400',
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

const stageConfig: Record<VersionStage, { label: string; color: 'green' | 'zinc' }> = {
  production: { label: 'Production', color: 'green' },
  beta: { label: 'Beta', color: 'zinc' },
  draft: { label: 'Draft', color: 'zinc' },
  archived: { label: 'Archived', color: 'zinc' },
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

function VersionCell({
  role,
  version,
  versionId,
}: {
  role: 'Production' | 'Candidate'
  version: CopilotVersion | undefined
  versionId: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{role}</p>
      <div className="mt-2 flex items-center gap-2">
        <span className="truncate font-mono text-sm font-medium text-zinc-950 tabular-nums dark:text-white">
          {version?.label ?? versionId}
        </span>
        {version ? <Badge color={stageConfig[version.stage].color}>{stageConfig[version.stage].label}</Badge> : null}
      </div>
      {version ? <p className="mt-1 truncate font-mono text-xs text-zinc-500">{version.model}</p> : null}
    </div>
  )
}

/**
 * Shadow experiment summary card: candidate version mirrored against
 * production traffic, agreement vs the promotion threshold, and readiness.
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
  const meetsThreshold = experiment.agreementRate >= experiment.agreementThreshold
  const fillPercent = Math.min(100, Math.max(0, experiment.agreementRate * 100))
  const thresholdPercent = Math.min(100, Math.max(0, experiment.agreementThreshold * 100))

  return (
    <section className="overflow-hidden rounded-xl bg-white ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
      {/* Header: name + window left, status right */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-zinc-950/5 dark:border-white/5 px-6 py-4">
        <div className="min-w-0">
          <Subheading className="truncate">{experiment.name}</Subheading>
          <p className="mt-1 text-xs text-zinc-500 tabular-nums">
            {experiment.endsAt
              ? `${formatDate(experiment.startedAt)} → ${formatDate(experiment.endsAt)}`
              : `Started ${formatDate(experiment.startedAt)}`}
          </p>
        </div>
        <ExperimentStatusBadge status={experiment.status} />
      </div>

      <div className="px-6 py-5">
        {/* Production vs candidate */}
        <div className="grid grid-cols-1 items-center gap-4 rounded-lg bg-zinc-50 p-4 ring-1 ring-zinc-950/5 dark:bg-zinc-950/50 dark:ring-white/5 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
          <VersionCell role="Production" version={productionVersion} versionId={experiment.productionVersionId} />
          <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase sm:px-2 dark:text-zinc-600">vs</span>
          <VersionCell role="Candidate" version={candidateVersion} versionId={experiment.candidateVersionId} />
        </div>

        {/* Agreement */}
        <div className="mt-6">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p className="flex items-baseline gap-x-2">
              <span className="text-3xl font-semibold tracking-tight text-zinc-950 tabular-nums dark:text-white">
                {formatPercent(experiment.agreementRate)}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">agreement</span>
            </p>
            <p className="text-xs text-zinc-500 tabular-nums">
              Threshold ≥ {formatPercent(experiment.agreementThreshold, 0)}
            </p>
          </div>

          <div aria-hidden="true" className="relative mt-3">
            <div className="h-2 overflow-hidden rounded-full bg-zinc-950/10 dark:bg-zinc-800">
              <div
                className={clsx('h-2 rounded-full', meetsThreshold ? 'bg-green-500' : 'bg-amber-500')}
                style={{ width: `${fillPercent}%` }}
              />
            </div>
            {/* Threshold tick */}
            <div className="absolute -top-1 -bottom-1 w-px bg-zinc-950/40 dark:bg-white/40" style={{ left: `${thresholdPercent}%` }} />
          </div>

          <dl className="mt-4 flex flex-wrap gap-y-2 divide-x divide-zinc-950/10 dark:divide-white/10 text-sm">
            <div className="flex items-baseline gap-x-2 pr-4">
              <dt className="text-zinc-500">Sampled runs</dt>
              <dd className="font-mono font-medium text-zinc-950 tabular-nums dark:text-white">
                {experiment.sampledRunCount.toLocaleString('en-US')}
              </dd>
            </div>
            <div className="flex items-baseline gap-x-2 pl-4">
              <dt className="text-zinc-500">Unsafe proposals</dt>
              <dd
                className={clsx(
                  'font-mono font-medium tabular-nums',
                  experiment.unsafeProposalCount > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-zinc-950 dark:text-white'
                )}
              >
                {experiment.unsafeProposalCount.toLocaleString('en-US')}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Promotion readiness */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-zinc-950/5 dark:border-white/5 px-6 py-4">
        <p className="text-sm font-medium text-zinc-950 dark:text-white">Promotion readiness</p>
        {meetsThreshold ? (
          <p className="flex items-center gap-x-1.5 text-sm font-medium text-green-700 dark:text-green-400">
            <CheckCircleIcon aria-hidden="true" className="size-4 shrink-0" />
            Meets agreement threshold
          </p>
        ) : (
          <p className="flex items-center gap-x-1.5 text-sm font-medium text-amber-600 dark:text-amber-400">
            <ExclamationTriangleIcon aria-hidden="true" className="size-4 shrink-0" />
            Below threshold (needs ≥ {formatPercent(experiment.agreementThreshold, 0)})
          </p>
        )}
      </div>
    </section>
  )
}
