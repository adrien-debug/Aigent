import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import type { RunsPageData } from '@/lib/runs-console/runs-page-data'
import { formatUsd } from '@/lib/agent-mission-control/format'
import { deriveRunsMetrics, formatDuration, formatPercent } from '@/lib/runs-console/runs-metrics'
import { Metric, ScreenHeader, Section } from './screen-primitives'

function tone(status: AgentRun['status']): StatusDotTone {
  if (status === 'completed') return 'positive'
  if (status === 'failed' || status === 'blocked') return 'negative'
  if (status === 'running') return 'pending'
  return 'neutral'
}

export function RunsScreen({ data }: { data: RunsPageData }) {
  const metrics = deriveRunsMetrics(data.runs)
  return (
    <div className="space-y-8">
      <ScreenHeader title="Runs" description="Operational executions from the last 24 hours." actions={<Button href="/admin" outline>Back to overview</Button>} />
      {data.degraded.length > 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-zinc-200">
          Labels partially unavailable. Run rows remain real and unresolved identifiers are shown unchanged.
        </div>
      ) : null}
      <div className="grid divide-y divide-white/8 border-y border-white/8 sm:grid-cols-2 sm:divide-x sm:divide-y-0 xl:grid-cols-4">
        <Metric label="Runs shown" value={metrics.total} detail={`${data.windowRunCount} in the 24h window`} />
        <Metric label="Running" value={metrics.running} detail="Currently executing" />
        <Metric label="Success" value={metrics.successRate === null ? '—' : formatPercent(metrics.successRate)} detail="Completed terminal runs" />
        <Metric label="Measured cost" value={metrics.measuredCostUsd === null ? '—' : formatUsd(metrics.measuredCostUsd)} detail={`${metrics.unmeasuredCostRuns} unmeasured`} />
      </div>
      <Section title="Run activity" description={`Capped at ${data.tableRowCap} rows; refreshed ${new Date(data.nowIso).toLocaleString('en-GB')}`}>
        {data.runs.length === 0 ? (
          <p className="px-6 py-14 text-center text-sm text-zinc-400">No operational run was recorded in this window.</p>
        ) : (
          <Table caption="Operational run activity" dense>
            <TableHead><TableRow><TableHeader>Status</TableHeader><TableHeader>Agent</TableHeader><TableHeader>Project</TableHeader><TableHeader>Model</TableHeader><TableHeader>Latency</TableHeader><TableHeader>Cost</TableHeader><TableHeader>Started</TableHeader></TableRow></TableHead>
            <TableBody>
              {data.runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell><StatusDot tone={tone(run.status)}>{run.status}</StatusDot></TableCell>
                  <TableCell><p className="max-w-48 truncate text-white">{data.agentNameById.get(run.copilotId) ?? run.copilotId}</p></TableCell>
                  <TableCell><p className="max-w-40 truncate text-zinc-300">{data.projectNameById.get(run.projectId) ?? run.projectId}</p></TableCell>
                  <TableCell><span className="text-xs text-zinc-400">{run.modelUnverified ? 'Unverified' : (run.resolvedModel ?? '—')}</span></TableCell>
                  <TableCell>{formatDuration(run.latencyMs) ?? '—'}</TableCell>
                  <TableCell>{run.costUsd === null ? '—' : formatUsd(run.costUsd)}</TableCell>
                  <TableCell><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleTimeString('en-GB')}</time></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>
    </div>
  )
}
