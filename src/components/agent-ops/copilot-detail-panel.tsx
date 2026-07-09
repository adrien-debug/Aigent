import clsx from 'clsx'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { passRateClassName } from '@/components/agent-ops/health-format'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { DescriptionDetails, DescriptionList, DescriptionTerm } from '@/components/catalyst/description-list'
import { formatDate, formatDurationMs, formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { MODEL_PROVIDER_LABELS, getVersion } from '@/lib/agent-mission-control/mock-data'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/** No test signal yet: draft/archived copilots, or zero pass rate with zero runs. */
function isUntested(copilot: Copilot): boolean {
  return (
    copilot.health.testPassRate === 0 &&
    (copilot.status === 'draft' || copilot.status === 'archived' || copilot.health.runsLast24h === 0)
  )
}

function errorRateClassName(rate: number): string {
  if (rate > 0.15) return 'text-rose-600 dark:text-rose-400'
  if (rate > 0.05) return 'text-amber-600 dark:text-amber-400'
  return 'text-zinc-700 dark:text-zinc-300'
}

/**
 * Compact copilot summary panel: identity, model, tags and rolled-up health.
 * Server-safe (no state) — usable from both server pages and client views.
 */
export function CopilotDetailPanel({ copilot, project }: { copilot: Copilot; project?: Project }) {
  const productionVersion = copilot.productionVersionId ? getVersion(copilot.productionVersionId) : undefined

  return (
    <AgentSectionCard title={copilot.name} description={project ? `${project.name} project` : undefined}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={copilot.status} />
        <RuntimeBadge runtime={copilot.runtime} />
      </div>

      <DescriptionList className="mt-4">
        <DescriptionTerm>Owner</DescriptionTerm>
        <DescriptionDetails>{copilot.owner}</DescriptionDetails>

        <DescriptionTerm>Model</DescriptionTerm>
        <DescriptionDetails>
          <span className="font-mono text-xs tabular-nums">{copilot.model}</span>
        </DescriptionDetails>

        <DescriptionTerm>Provider</DescriptionTerm>
        <DescriptionDetails>{MODEL_PROVIDER_LABELS[copilot.modelProvider]}</DescriptionDetails>

        <DescriptionTerm>Created</DescriptionTerm>
        <DescriptionDetails className="font-mono text-xs tabular-nums">
          {formatDate(copilot.createdAt)}
        </DescriptionDetails>

        <DescriptionTerm>Updated</DescriptionTerm>
        <DescriptionDetails className="font-mono text-xs tabular-nums">
          {formatDate(copilot.updatedAt)}
        </DescriptionDetails>

        <DescriptionTerm>Tags</DescriptionTerm>
        <DescriptionDetails>
          {copilot.tags.length > 0 ? (
            <span className="flex flex-wrap gap-1.5">
              {copilot.tags.map((tag) => (
                <Badge key={tag} color="zinc" className="font-mono">
                  {tag}
                </Badge>
              ))}
            </span>
          ) : (
            <span className="text-zinc-500">No tags</span>
          )}
        </DescriptionDetails>

        <DescriptionTerm>Test pass rate</DescriptionTerm>
        <DescriptionDetails>
          {isUntested(copilot) ? (
            <span className="font-mono text-zinc-500 tabular-nums">
              <span aria-hidden="true">—</span>
              <span className="sr-only">not tested</span>
            </span>
          ) : (
            <span className={clsx('font-mono tabular-nums', passRateClassName(copilot.health.testPassRate))}>
              {formatPercent(copilot.health.testPassRate)}
            </span>
          )}
        </DescriptionDetails>

        <DescriptionTerm>Benchmark score</DescriptionTerm>
        <DescriptionDetails>
          <span className="font-mono tabular-nums">{copilot.health.benchmarkScore}</span>
          <span className="text-zinc-500"> / 100</span>
        </DescriptionDetails>

        <DescriptionTerm>Error rate 24h</DescriptionTerm>
        <DescriptionDetails>
          <span className={clsx('font-mono tabular-nums', errorRateClassName(copilot.health.errorRateLast24h))}>
            {formatPercent(copilot.health.errorRateLast24h)}
          </span>
        </DescriptionDetails>

        <DescriptionTerm>Avg latency</DescriptionTerm>
        <DescriptionDetails>
          <span className="font-mono tabular-nums">{formatDurationMs(copilot.health.avgLatencyMs)}</span>
        </DescriptionDetails>

        <DescriptionTerm>Cost 24h</DescriptionTerm>
        <DescriptionDetails>
          {copilot.health.runsLast24h === 0 ? (
            <span className="font-mono text-zinc-500 tabular-nums">
              <span aria-hidden="true">—</span>
              <span className="sr-only">no runs</span>
            </span>
          ) : (
            <span className="font-mono tabular-nums">{formatUsd(copilot.health.costLast24hUsd)}</span>
          )}
        </DescriptionDetails>
      </DescriptionList>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
        <span className="text-xs text-zinc-500">
          {copilot.productionVersionId ? (
            <>
              Production{' '}
              <span className="font-mono tabular-nums text-zinc-600 dark:text-zinc-400">
                {productionVersion?.label ?? copilot.productionVersionId}
              </span>
            </>
          ) : (
            'Not in production'
          )}
        </span>
        <Button outline href={`/admin/agents/${copilot.id}`}>
          Open copilot
        </Button>
      </div>
    </AgentSectionCard>
  )
}
