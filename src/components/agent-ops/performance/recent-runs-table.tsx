import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import {
  formatDurationMs,
  formatRelative,
  formatTimestamp,
  formatUsd,
} from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

/**
 * RecentRunsTable — fleet-wide live traffic feed. Run status renders through
 * the canonical `RunStatusText` (mute zinc label — never a pill), the header
 * row wears the standard `bg-black/20` structural wash, and "Started" reads
 * relative to the render instant (absolute UTC kept in the title). Columns are
 * truncated to fit the viewport at 1440px; horizontal scroll stays a mobile
 * safety net only.
 */
export function RecentRunsTable({
  runs,
  copilotById,
  projectNameById,
  nowIso,
}: {
  runs: AgentRun[]
  copilotById: Map<string, Copilot>
  projectNameById: Map<string, string>
  nowIso: string
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Recent Runs"
        meta={<span className="text-xs text-zinc-500">{runs.length} runs · all projects</span>}
      />
      <div className="overflow-x-auto no-scrollbar">
        <Table className="w-full border-collapse px-6 text-left [--gutter:--spacing(0)]">
        <TableHead>
          <TableRow className="border-b border-white/5">
            <TableHeader>Run & Copilot</TableHeader>
            <TableHeader>Project</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader className="w-1/3">Input Summary</TableHeader>
            <TableHeader className="text-right">Latency</TableHeader>
            <TableHeader className="text-right">Cost</TableHeader>
            <TableHeader className="text-right">Started</TableHeader>
            <TableHeader className="text-center">
              <span className="sr-only">Trace</span>
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y divide-white/5">
          {runs.map((run) => {
            const copilot = copilotById.get(run.copilotId)
            return (
              <TableRow key={run.id} className="group">
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    <Link
                      href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                      className="truncate text-sm font-medium text-white group-hover:underline"
                    >
                      {copilot?.name ?? run.copilotId}
                    </Link>
                    <span className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-zinc-500">{run.id}</span>
                  </div>
                </TableCell>
                <TableCell>
                  {copilot?.projectId ? (
                    <span className="text-xs text-zinc-400">
                      {projectNameById.get(copilot.projectId) ?? '—'}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={`size-1.5 shrink-0 rounded-full ${
                        run.status === 'completed'
                          ? 'bg-accent-500'
                          : run.status === 'failed'
                            ? 'bg-accent-700'
                            : 'bg-zinc-600'
                      }`}
                    />
                    <RunStatusText status={run.status} />
                  </span>
                </TableCell>
                <TableCell>
                  <span className="block max-w-md truncate text-xs text-zinc-400" title={run.inputSummary}>
                    {run.inputSummary}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs text-zinc-300 tabular-nums">
                    {formatDurationMs(run.latencyMs)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs text-zinc-400 tabular-nums">{formatUsd(run.costUsd)}</span>
                </TableCell>
                <TableCell className="text-right">
                  <span
                    className="font-mono text-xs whitespace-nowrap text-zinc-500 tabular-nums"
                    title={formatTimestamp(run.startedAt)}
                  >
                    {formatRelative(run.startedAt, nowIso)}
                  </span>
                </TableCell>
                <TableCell className="text-center">
                  {run.traceUrl ? (
                    <a
                      href={run.traceUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open trace for run ${run.id} in LangSmith`}
                      title="Open trace in LangSmith"
                      className="-my-3.5 inline-flex size-11 items-center justify-center rounded-md text-zinc-500 outline-offset-2 transition-colors hover:bg-[var(--accent-soft)] hover:text-accent-400 focus-visible:outline-2 focus-visible:outline-accent-500"
                    >
                      <ArrowTopRightOnSquareIcon className="size-4" />
                    </a>
                  ) : (
                    <span className="text-zinc-600">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        </Table>
      </div>
    </SurfaceCard>
  )
}
