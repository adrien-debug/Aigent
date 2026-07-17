import { SignalIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatPercent, formatTimestamp } from '@/lib/agent-mission-control/format'
import type { RuntimeTelemetryAgentRollup } from '@/lib/agent-mission-control/runtime-telemetry-store'

const numberFormat = new Intl.NumberFormat('en-US')

const PASS_RATE_ACCENT_THRESHOLD = 0.9

/**
 * TelemetryAgentsTable — every (project, agent) pair that has reported
 * runtime telemetry, newest signal first. Names resolve through the copilot
 * lookup maps built server-side; an agent whose copilot record was since
 * deleted still shows its raw id rather than disappearing.
 */
export function TelemetryAgentsTable({
  rows,
  copilotNameById,
  projectNameById,
}: {
  rows: RuntimeTelemetryAgentRollup[]
  copilotNameById: Map<string, string>
  projectNameById: Map<string, string>
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Agents Reporting"
        meta={
          <span className="text-xs text-zinc-500">
            {rows.length} agent{rows.length === 1 ? '' : 's'}
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={SignalIcon}
          title="No agents reporting"
          description="Runtime telemetry is opt-in from the delivered runtime — agents appear here as soon as they report their first event."
        />
      ) : (
        <div className="overflow-x-auto no-scrollbar">
          <Table className="w-full text-left border-collapse min-w-[760px]">
            <TableHead>
              <TableRow className="border-b border-white/5 bg-black/20">
                <TableHeader className="px-6">Agent</TableHeader>
                <TableHeader className="px-6">Project</TableHeader>
                <TableHeader className="px-6 text-right">Events</TableHeader>
                <TableHeader className="px-6 text-right">Success Rate</TableHeader>
                <TableHeader className="px-6 text-right">Avg Latency</TableHeader>
                <TableHeader className="px-6 text-right">Last Seen</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y divide-white/5">
              {rows.map((row) => (
                <TableRow
                  key={`${row.projectId}::${row.agentId}`}
                  className="hover:bg-[var(--color-surface-interactive)] transition-colors"
                >
                  <TableCell className="py-4 px-6">
                    <Link
                      href={`/admin/agents/${row.agentId}`}
                      className="text-sm font-medium text-white hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                    >
                      {copilotNameById.get(row.agentId) ?? row.agentId}
                    </Link>
                  </TableCell>
                  <TableCell className="py-4 px-6">
                    <Link
                      href={`/admin/projects/${row.projectId}`}
                      className="text-xs text-zinc-300 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                    >
                      {projectNameById.get(row.projectId) ?? row.projectId}
                    </Link>
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-sm font-mono tabular-nums text-white">
                      {numberFormat.format(row.totalRuns)}
                    </span>
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    {row.successRate !== null ? (
                      <span
                        className={clsx(
                          'text-sm font-mono tabular-nums',
                          row.successRate >= PASS_RATE_ACCENT_THRESHOLD ? 'text-accent-400' : 'text-zinc-300'
                        )}
                      >
                        {formatPercent(row.successRate)}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-sm font-mono tabular-nums text-zinc-300">
                      {row.avgLatencyMs !== null ? formatDurationMs(row.avgLatencyMs) : '—'}
                    </span>
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-xs font-mono tabular-nums text-zinc-400">
                      {row.lastSeenAt !== null ? formatTimestamp(row.lastSeenAt) : '—'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </SurfaceCard>
  )
}
