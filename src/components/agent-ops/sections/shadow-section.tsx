
import { AgentBentoCard } from '@/components/agent-ops/agent-bento-card'
import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ShadowExperimentCard } from '@/components/agent-ops/shadow-experiment-card'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { SplitBar, type SplitSegment } from '@/components/agent-ops/widgets/split-bar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import { getCopilot, getShadowExperimentsForCopilot, getVersion } from '@/lib/agent-mission-control/data'

function statusLabel(s: string) {
  const t = s.replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

export async function ShadowSection({ copilotId }: { copilotId: string }) {
  const id = copilotId
  const copilot = await getCopilot(id)
  if (!copilot) return null

  const experiments = await getShadowExperimentsForCopilot(id)
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

  const mismatches = experiments
    .flatMap((e) => e.mismatches)
    .sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1))

  // KPI aggregates derived from the already-fetched experiments (serializable numbers).
  const bestAgreement = Math.max(...experiments.map((e) => e.agreementRate))
  const belowThresholdCount = experiments.filter((e) => e.agreementRate < e.agreementThreshold).length
  const unsafeTotal = experiments.reduce((sum, e) => sum + e.unsafeProposalCount, 0)

  // Severity mix across every sampled mismatch → one dense split bar.
  const severitySegments: SplitSegment[] = [
    { key: 'info', label: 'Info', value: mismatches.filter((m) => m.severity === 'info').length, tone: 'zinc' },
    { key: 'warning', label: 'Warning', value: mismatches.filter((m) => m.severity === 'warning').length, tone: 'accent-500' },
    { key: 'unsafe', label: 'Unsafe', value: mismatches.filter((m) => m.severity === 'unsafe').length, tone: 'accent-700' },
  ]

  const experimentCards = await Promise.all(
    sorted.map(async (experiment) => {
      const [productionVersion, candidateVersion] = await Promise.all([
        getVersion(experiment.productionVersionId),
        getVersion(experiment.candidateVersionId),
      ])
      return { experiment, productionVersion, candidateVersion }
    })
  )

  return (
    <div className="space-y-8">
      <AgentKpiBand
        stats={[
          {
            name: 'Experiments',
            value: String(experiments.length),
            hint: `${latest.status === 'running' ? 'Latest sampling live' : 'Latest complete'}`,
          },
          {
            name: 'Best agreement',
            value: formatPercent(bestAgreement),
            hint: 'Closest candidate to production',
            viz: <LinearMeter value={bestAgreement} ariaLabel="Best shadow agreement across experiments" />,
          },
          {
            name: 'Below threshold',
            value: String(belowThresholdCount),
            changeType: belowThresholdCount > 0 ? 'negative' : undefined,
            hint: belowThresholdCount > 0 ? 'Not yet promotable' : 'All experiments meet the gate',
          },
          {
            name: 'Unsafe proposals',
            value: String(unsafeTotal),
            changeType: unsafeTotal > 0 ? 'negative' : undefined,
            hint: unsafeTotal > 0 ? 'Blocks promotion' : 'None flagged',
          },
        ]}
      />

      {/* Experiments */}
      {experimentCards.map(({ experiment, productionVersion, candidateVersion }) => (
        <ShadowExperimentCard
          key={experiment.id}
          experiment={experiment}
          productionVersion={productionVersion}
          candidateVersion={candidateVersion}
        />
      ))}

      {/* Mismatches */}
      <AgentSectionCard
        title="Mismatches"
        description="Runs where the candidate proposed a different action than production."
        actions={
          mismatches.length > 0 ? (
            <div className="w-full sm:w-72">
              <SplitBar segments={severitySegments} />
            </div>
          ) : undefined
        }
        contentClassName="px-6 py-2"
      >
        {mismatches.length === 0 ? (
          <div className="py-8 text-center">
            <Text>No mismatches recorded — production and candidate agreed on every sampled run.</Text>
          </div>
        ) : (
          <Table striped bleed className="[--gutter:--spacing(6)]">
            <TableHead>
              <TableRow>
                <TableHeader className="w-0" title="Times in UTC">
                  When
                </TableHeader>
                <TableHeader className="w-0">Severity</TableHeader>
                <TableHeader>Summary</TableHeader>
                <TableHeader title="Production action → candidate action">Divergence</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {mismatches.map((mismatch) => (
                <TableRow
                  key={mismatch.id}
                  href={`/admin/agents/${id}/runs?run=${mismatch.runId}`}
                  title={`Open run ${mismatch.runId}`}
                >
                  <TableCell
                    className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
                    title={formatTimestamp(mismatch.occurredAt)}
                  >
                    {formatTimestamp(mismatch.occurredAt).replace(' UTC', '')}
                  </TableCell>
                  <TableCell>
                    <span className="text-zinc-500 dark:text-zinc-400">{statusLabel(mismatch.severity)}</span>
                  </TableCell>
                  <TableCell className="text-zinc-700 dark:text-zinc-300">
                    <span className="block max-w-72 truncate" title={mismatch.summary}>
                      {mismatch.summary}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className="flex max-w-80 items-center gap-1.5 font-mono text-xs">
                      <span
                        className="min-w-0 flex-1 truncate text-zinc-500 dark:text-zinc-400"
                        title={mismatch.productionAction}
                      >
                        {mismatch.productionAction}
                      </span>
                      <span aria-hidden="true" className="shrink-0 text-zinc-400 dark:text-zinc-600">
                        →
                      </span>
                      <span
                        className="min-w-0 flex-1 truncate text-zinc-700 dark:text-zinc-300"
                        title={mismatch.candidateAction}
                      >
                        {mismatch.candidateAction}
                      </span>
                    </span>
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
