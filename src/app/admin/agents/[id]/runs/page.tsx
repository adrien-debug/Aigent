import { notFound } from 'next/navigation'
import {
  CostValue,
  DurationValue,
  RateValue,
  TimestampValue,
} from '@/components/agent-ops/agent-detail/agent-value'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'
import { eyebrowClass, surfaceSectionClass } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Runs — launch, and the recorded history (AIGENT-AGENT-PAGES-021).
 *
 * The launcher renders ONLY when the canonical gate would accept a run.
 * Offering a form guaranteed to 409 is worse than offering none: the operator
 * writes an input, submits, and only then learns it was never launchable.
 */

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className={surfaceSectionClass}>
      <div className="px-5 pt-4 pb-3">
        <Subheading level={2}>{title}</Subheading>
        {description ? <Text className="mt-1 !text-xs">{description}</Text> : null}
      </div>
      <div className="px-5 pb-5">{children}</div>
    </section>
  )
}

function runStatusColor(status: string): 'accent' | 'accentSolid' | 'zinc' {
  if (status === 'completed') return 'accent'
  if (status === 'failed' || status === 'blocked') return 'accentSolid'
  return 'zinc'
}

export default async function AgentRunsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  const { copilot, runs, metrics, executable, blockers } = detail

  const failed = runs.filter((r) => r.status === 'failed').length
  const succeeded = runs.filter((r) => r.status === 'completed').length
  const totalToolCalls = runs.reduce((a, r) => a + (r.toolCallCount ?? 0), 0)

  return (
    <div className="flex flex-col gap-6">
      <dl className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl md:grid-cols-6 ${surfaceSectionClass}`}>
        {[
          { label: 'Total runs', value: String(metrics.totalRuns) },
          { label: 'Succeeded', value: String(succeeded) },
          { label: 'Failed', value: String(failed) },
          { label: 'Success rate', value: <RateValue value={metrics.successRate} /> },
          { label: 'Avg duration', value: <DurationValue value={metrics.avgDurationMs} /> },
          { label: 'Tool calls', value: String(totalToolCalls) },
        ].map((cell) => (
          <div key={cell.label} className="px-5 py-4">
            <dt className={eyebrowClass}>{cell.label}</dt>
            <dd className="mt-1 font-mono text-xl/7 font-light tabular-nums text-zinc-100">{cell.value}</dd>
          </div>
        ))}
      </dl>

      {executable ? (
        <Section title="Start a run" description="Runs execute live against the configured model.">
          <RunCopilotPanel
            copilotId={copilot.id}
            copilotName={copilot.name}
            copilotSlug={copilot.slug}
            copilotTags={copilot.tags}
          />
        </Section>
      ) : (
        <Section title="Start a run" description="Unavailable — this agent cannot execute in its current state.">
          <div className="flex flex-col gap-3">
            {blockers.map((b) => (
              <div key={b.code} className="text-sm leading-6">
                <span className="font-medium text-zinc-100">{b.label}</span>
                <span className="text-zinc-400"> — {b.detail}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Run history" description="Every recorded run, most recent first.">
        {runs.length === 0 ? (
          <EmptyState
            title="No runs yet"
            description="Once this agent executes, each run is recorded here with its cost, duration and tool calls."
          />
        ) : (
          <Table dense>
            <TableHead>
              <TableRow>
                <TableHeader>Started</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Model</TableHeader>
                <TableHeader className="text-right">Duration</TableHeader>
                <TableHeader className="text-right">Cost</TableHeader>
                <TableHeader className="text-right">Tools</TableHeader>
                <TableHeader>Result</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="whitespace-nowrap">
                    <TimestampValue value={run.startedAt} />
                  </TableCell>
                  <TableCell>
                    <Badge color={runStatusColor(run.status)}>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs whitespace-nowrap text-zinc-400">
                    {/* An unproven model is never presented as fact. */}
                    {run.resolvedModel ? (
                      <>
                        {run.resolvedModel}
                        {run.modelUnverified !== false ? (
                          <span className="text-zinc-600"> (unverified)</span>
                        ) : null}
                      </>
                    ) : (
                      <span className="text-zinc-600">unverified</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <DurationValue value={run.latencyMs ?? null} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    <CostValue value={run.costUsd ?? null} />
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{run.toolCallCount}</TableCell>
                  <TableCell className="max-w-md truncate text-zinc-400">{run.outputSummary || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
