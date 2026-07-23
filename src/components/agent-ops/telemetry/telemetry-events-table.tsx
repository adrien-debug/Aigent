import { BoltIcon } from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatRelative, formatTimestamp } from '@/lib/agent-mission-control/format'
import type { RuntimeTelemetryEvent } from '@/lib/agent-mission-control/runtime-telemetry-store'

function errorCategoryOf(error: RuntimeTelemetryEvent['error']): string | null {
  const category = (error as Record<string, unknown>)?.category
  return typeof category === 'string' && category.trim().length > 0 ? category : null
}

/**
 * TelemetryEventsTable — fleet-wide raw event feed (variant of RecentRunsTable
 * for the opt-in runtime telemetry channel). Only redacted shapes ever land in
 * these rows — no raw prompt/output, error carries a hashed summary at most.
 */
export function TelemetryEventsTable({
  events,
  copilotNameById,
  projectNameById,
  nowIso,
}: {
  events: RuntimeTelemetryEvent[]
  copilotNameById: Map<string, string>
  projectNameById: Map<string, string>
  nowIso: string
}) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Recent Telemetry Events"
        meta={<span className="text-xs text-zinc-500">{events.length} events · all projects</span>}
      />
      {events.length === 0 ? (
        <EmptyState
          icon={BoltIcon}
          title="No telemetry events yet"
          description="Events appear here as soon as an opted-in delivered agent reports its first ping."
        />
      ) : (
        <div className="overflow-x-auto no-scrollbar">
          <Table className="w-full border-collapse text-left">
            <TableHead>
              <TableRow className="border-b border-white/5">
                <TableHeader>Agent</TableHeader>
                <TableHeader>Project</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Provider</TableHeader>
                <TableHeader className="text-right">Latency</TableHeader>
                <TableHeader>Error</TableHeader>
                <TableHeader className="text-right">Received</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y divide-white/5">
              {events.map((event) => {
                const category = errorCategoryOf(event.error)
                return (
                  <TableRow key={event.id} className="group transition-colors hover:bg-white/2.5">
                    <TableCell className="px-6 py-3">
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={`/admin/agents/${event.agentId}`}
                          className="truncate text-sm font-medium text-white group-hover:underline"
                        >
                          {copilotNameById.get(event.agentId) ?? event.agentId}
                        </Link>
                        <span className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-zinc-500">
                          {event.runId}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      <span className="block max-w-32 truncate text-xs text-zinc-400">
                        {projectNameById.get(event.projectId) ?? event.projectId}
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${
                            event.status === 'completed'
                              ? 'bg-accent-500'
                              : event.status === 'failed'
                                ? 'bg-accent-700'
                                : 'bg-zinc-600'
                          }`}
                        />
                        <span className="text-xs text-zinc-300 capitalize">{event.status}</span>
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      <span className="text-xs text-zinc-400">{event.provider ?? '—'}</span>
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right">
                      <span className="font-mono text-xs text-zinc-300 tabular-nums">
                        {event.latencyMs !== null ? formatDurationMs(event.latencyMs) : '—'}
                      </span>
                    </TableCell>
                    <TableCell className="px-6 py-3">
                      {category !== null ? (
                        <span className="block max-w-32 truncate text-xs text-accent-400" title={category}>
                          {category}
                        </span>
                      ) : event.status === 'failed' ? (
                        <span className="text-xs text-zinc-600" title="failed, but no error.category reported">
                          not reported
                        </span>
                      ) : (
                        <span className="text-xs text-zinc-600">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right">
                      <span
                        className="font-mono text-xs whitespace-nowrap text-zinc-500 tabular-nums"
                        title={formatTimestamp(event.receivedAt)}
                      >
                        {formatRelative(event.receivedAt, nowIso)}
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </SurfaceCard>
  )
}
