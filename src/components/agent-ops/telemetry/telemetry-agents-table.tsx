import { SignalIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
        // Scrollbar deliberately NOT hidden: the table is `min-w-[760px]`, so under
        // 760px real columns sit off-screen. `no-scrollbar` removed the only hint
        // that they exist at all. The fade+ResizeObserver affordance
        // (agent-detail-nav) needs a client boundary; this table is a server
        // component, and the native bar costs nothing and is understood everywhere.
        <div className="overflow-x-auto">
          <Table className="w-full text-left border-collapse min-w-[760px]">
            <TableHead>
              <TableRow className="border-b border-white/5">
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
                // No row-level hover: the row is NOT navigable and cannot be — it
                // carries TWO distinct destinations (agent, project), so there is no
                // single href to hand the primitive. The local
                // `hover:bg-[var(--color-surface-interactive)]` lit the whole row and
                // promised a click target that never existed (and was one of three
                // different hover values across these tables). The primitive reserves
                // hover for rows with an `href`; both links already carry their own
                // hover:underline and focus ring.
                <TableRow key={`${row.projectId}::${row.agentId}`}>
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
                      <NotMeasuredDash />
                    )}
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-sm font-mono tabular-nums text-zinc-300">
                      {row.avgLatencyMs !== null ? formatDurationMs(row.avgLatencyMs) : <NotMeasuredDash />}
                    </span>
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-xs font-mono tabular-nums text-zinc-400">
                      {row.lastSeenAt !== null ? formatTimestamp(row.lastSeenAt) : <NotMeasuredDash />}
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
