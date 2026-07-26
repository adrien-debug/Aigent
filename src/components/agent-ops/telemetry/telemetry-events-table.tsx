import { BoltIcon } from '@heroicons/react/24/outline'

import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { TelemetryScrollAffordance } from '@/components/agent-ops/telemetry/telemetry-scroll-affordance'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
        meta={
          // zinc-400, not zinc-500: measured 3.59:1 on the raised plane
          // (#1a1a1e) for a 4.5 threshold — the row count was under AA. Same
          // call and same ratio as dashboard-kpi-strip's integrity footer.
          <span className="text-xs text-zinc-400">{events.length} events · all projects</span>
        }
      />
      {events.length === 0 ? (
        <EmptyState
          icon={BoltIcon}
          title="No telemetry events yet"
          description="Events appear here as soon as an opted-in delivered agent reports its first ping."
        />
      ) : (
        // Same geometry contract as TelemetryAgentsTable, so the two stacked
        // tables share ONE gutter and ONE row rhythm: `bleed` + `[--gutter:0]` +
        // `px-6` puts the first glyph exactly under the card header title, and
        // `dense` makes the py-3 rows that every cell here asked for real — the
        // per-cell `py-3`/`px-6` written before were dead overrides losing to the
        // primitive's own `py-4`/`px-4` in the compiled sheet.
        <TelemetryScrollAffordance>
          <Table bleed dense data-scrollport className="px-6 [--gutter:--spacing(0)]">
            {/* Same as the agents table: no local rules on the head row or the
                body. Under the collapsed border model the cell edge wins over
                the row edge, so `border-b`/`divide-y` written here never painted
                a pixel — the primitive's own `[&_th]:border-b` and TableCell
                `border-b` draw both separators at ONE weight. */}
            <TableHead>
              <TableRow>
                <TableHeader>Agent</TableHeader>
                <TableHeader>Project</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Provider</TableHeader>
                <TableHeader className="text-right">Latency</TableHeader>
                <TableHeader>Error</TableHeader>
                <TableHeader className="text-right">Received</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {events.map((event) => {
                const category = errorCategoryOf(event.error)
                return (
                  // No row-level hover: the row is NOT navigable (an event has no
                  // detail page of its own, and several cells carry their own
                  // `title` tooltip a full-row overlay link would swallow). The
                  // primitive already reserves hover feedback for rows with an
                  // `href`; a local `hover:bg-*` here promised a click target that
                  // does not exist. Feedback now belongs to the one thing that IS
                  // interactive — the agent link, which also gets its own focus ring
                  // since the row no longer provides one.
                  <TableRow key={event.id}>
                    <TableCell>
                      <div className="flex min-w-0 flex-col">
                        <Link
                          href={`/admin/agents/${event.agentId}`}
                          className="truncate rounded text-sm font-medium text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                        >
                          {copilotNameById.get(event.agentId) ?? event.agentId}
                        </Link>
                        {/* zinc-400: at 10px mono the run id measured 3.59:1 on
                            the raised plane — an identifier an operator is
                            expected to COPY must clear AA, not merely hint. */}
                        <span className="mt-0.5 max-w-40 truncate font-mono text-[10px] text-zinc-400">
                          {event.runId}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="block max-w-32 truncate text-xs text-zinc-400">
                        {projectNameById.get(event.projectId) ?? event.projectId}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`size-1.5 shrink-0 rounded-full ${
                            event.status === 'completed'
                              ? 'bg-accent-500'
                              : event.status === 'failed'
                                ? 'bg-[var(--state-danger-solid)]'
                                : 'bg-zinc-600'
                          }`}
                        />
                        <span className="text-xs text-zinc-300 capitalize">{event.status}</span>
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="text-xs text-zinc-400">{event.provider ?? <NotMeasuredDash />}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="font-mono text-xs text-zinc-300 tabular-nums">
                        {event.latencyMs !== null ? formatDurationMs(event.latencyMs) : <NotMeasuredDash />}
                      </span>
                    </TableCell>
                    <TableCell>
                      {category !== null ? (
                        <span className="block max-w-32 truncate text-xs text-[var(--state-danger-text)]" title={category}>
                          {category}
                        </span>
                      ) : event.status === 'failed' ? (
                        // zinc-600 measured 2.25:1 here — half the AA floor. A
                        // reader could not tell "not reported" apart from an
                        // empty cell, which turns a missing signal into a silent
                        // one; the doctrine says an absence is STATED, so it has
                        // to be legible. zinc-400 like every other quiet role.
                        <span className="text-xs text-zinc-400" title="failed, but no error.category reported">
                          not reported
                        </span>
                      ) : (
                        // Deliberately NOT NotMeasuredDash: this branch is reached
                        // only when the event did not fail, so the error is not
                        // "unmeasured", it is genuinely absent. Announcing "not
                        // measured" here would assert an unknown where the runtime
                        // reported a known success. Same aria-hidden + sr-only shape
                        // as the unranked RankBadge, with the truthful word.
                        <span className="text-xs text-zinc-400">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">no error</span>
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span
                        className="font-mono text-xs whitespace-nowrap text-zinc-400 tabular-nums"
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
        </TelemetryScrollAffordance>
      )}
    </SurfaceCard>
  )
}
