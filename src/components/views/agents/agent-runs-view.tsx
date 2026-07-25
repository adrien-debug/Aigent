import {
  CostValue,
  DurationValue,
  RateValue,
  TimestampValue,
} from '@/components/agent-ops/agent-detail/agent-value'
import { AgentSection as Section } from '@/components/agent-ops/agent-section'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { PageLayout } from '@/components/shell/page-layout'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { eyebrowClass } from '@/components/shell/page-header'
import { surfaceSectionClass } from '@/components/ui/section'
import type { AgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Runs — launch, and the recorded history (AIGENT-AGENT-PAGES-021).
 *
 * The launcher renders ONLY when the canonical gate would accept a run.
 * Offering a form guaranteed to 409 is worse than offering none: the operator
 * writes an input, submits, and only then learns it was never launchable.
 */
export function AgentRunsView({ detail }: { detail: AgentDetail }) {
  const { copilot, runs, metrics, executable, blockers } = detail

  const failed = runs.filter((r) => r.status === 'failed').length
  const succeeded = runs.filter((r) => r.status === 'completed').length
  const totalToolCalls = runs.reduce((a, r) => a + (r.toolCallCount ?? 0), 0)

  return (
    <PageLayout>
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
                    <RunStatusText status={run.status} />
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
    </PageLayout>
  )
}
