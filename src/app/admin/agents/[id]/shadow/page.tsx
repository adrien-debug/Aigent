import { notFound } from 'next/navigation'

import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentMetricCard } from '@/components/agent-ops/agent-metric-card'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ShadowExperimentCard } from '@/components/agent-ops/shadow-experiment-card'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import { getCopilot, getShadowExperimentsForCopilot, getVersion } from '@/lib/agent-mission-control/mock-data'
import type { ShadowMismatch } from '@/lib/agent-mission-control/types'

const severityConfig: Record<ShadowMismatch['severity'], { label: string; color: 'zinc' | 'amber' | 'rose' }> = {
  info: { label: 'Info', color: 'zinc' },
  warning: { label: 'Warning', color: 'amber' },
  unsafe: { label: 'Unsafe', color: 'rose' },
}

function SeverityBadge({ severity }: { severity: ShadowMismatch['severity'] }) {
  const config = severityConfig[severity]
  return <Badge color={config.color}>{config.label}</Badge>
}

export default async function ShadowPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const experiments = getShadowExperimentsForCopilot(id)
  const sorted = [...experiments].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
  const [latest] = sorted

  if (!latest) {
    return (
      <AgentBentoCard
        eyebrow="Shadow mode"
        title="No shadow experiments yet"
        description="Run a candidate version silently alongside production traffic to measure how often it agrees with the serving version. Agreement, sampled runs and mismatches will appear here once an experiment is sampling traffic."
      />
    )
  }

  const current = sorted.find((e) => e.status === 'running') ?? latest
  const totalSampled = experiments.reduce((sum, e) => sum + e.sampledRunCount, 0)
  const totalUnsafe = experiments.reduce((sum, e) => sum + e.unsafeProposalCount, 0)

  const diffPts = (current.agreementRate - current.agreementThreshold) * 100
  const agreementTrend = diffPts > 0 ? 'up' : diffPts < 0 ? 'down' : 'flat'

  const mismatches = experiments
    .flatMap((e) => e.mismatches)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))

  return (
    <div className="space-y-8">
      {/* Overview strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <AgentMetricCard
          label="Agreement rate"
          value={formatPercent(current.agreementRate)}
          delta={`${diffPts >= 0 ? '+' : ''}${diffPts.toFixed(1)} pts vs threshold`}
          trend={agreementTrend}
          hint={current.name}
        />
        <AgentMetricCard
          label="Sampled runs"
          value={totalSampled.toLocaleString('en-US')}
          hint={`Across ${experiments.length} ${experiments.length === 1 ? 'experiment' : 'experiments'}`}
        />
        <AgentMetricCard
          label="Unsafe proposals"
          value={totalUnsafe.toLocaleString('en-US')}
          hint={totalUnsafe > 0 ? 'Blocks promotion until reviewed' : 'None across all shadow traffic'}
        />
      </div>

      {/* Experiments */}
      {sorted.map((experiment) => (
        <ShadowExperimentCard
          key={experiment.id}
          experiment={experiment}
          productionVersion={getVersion(experiment.productionVersionId)}
          candidateVersion={getVersion(experiment.candidateVersionId)}
        />
      ))}

      {/* Mismatches */}
      <AgentSectionCard
        title="Mismatches"
        description="Runs where the candidate proposed a different action than production."
        contentClassName="px-6 py-2"
      >
        {mismatches.length === 0 ? (
          <div className="py-8 text-center">
            <Text>No mismatches recorded — production and candidate agreed on every sampled run.</Text>
          </div>
        ) : (
          <Table bleed className="[--gutter:--spacing(6)]">
            <TableHead>
              <TableRow>
                <TableHeader>When (UTC)</TableHeader>
                <TableHeader>Severity</TableHeader>
                <TableHeader>Summary</TableHeader>
                <TableHeader>Production action</TableHeader>
                <TableHeader>Candidate action</TableHeader>
                <TableHeader>Run</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {mismatches.map((mismatch) => (
                <TableRow key={mismatch.id}>
                  <TableCell className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatTimestamp(mismatch.occurredAt)}
                  </TableCell>
                  <TableCell>
                    <SeverityBadge severity={mismatch.severity} />
                  </TableCell>
                  <TableCell className="text-zinc-700 dark:text-zinc-300">
                    <span className="block max-w-96 truncate" title={mismatch.summary}>
                      {mismatch.summary}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-56 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
                      title={mismatch.productionAction}
                    >
                      {mismatch.productionAction}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span
                      className="block max-w-56 truncate font-mono text-xs text-zinc-500 dark:text-zinc-400"
                      title={mismatch.candidateAction}
                    >
                      {mismatch.candidateAction}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/agents/${id}/runs?run=${mismatch.runId}`}
                      className="font-mono text-xs text-zinc-700 underline decoration-zinc-950/20 underline-offset-4 tabular-nums hover:text-zinc-950 hover:decoration-zinc-950/40 dark:text-zinc-300 dark:decoration-white/20 dark:hover:text-white dark:hover:decoration-white/40"
                    >
                      {mismatch.runId}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </AgentSectionCard>
    </div>
  )
}
