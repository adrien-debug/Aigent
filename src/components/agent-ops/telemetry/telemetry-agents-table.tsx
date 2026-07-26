import { SignalIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { TelemetryScrollAffordance } from '@/components/agent-ops/telemetry/telemetry-scroll-affordance'
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
          // zinc-400, not zinc-500: measured 3.59:1 on the raised plane
          // (#1a1a1e) for a 4.5 threshold — under AA. Same call and same ratio
          // as dashboard-kpi-strip's integrity footer.
          <span className="text-xs text-zinc-400">
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
        // `min-w-[760px]` USED to sit here, and it landed on the scrollport (Table
        // forwards className to its own `overflow-x-auto` div), not on the table:
        // a scroll container as wide as its content can never scroll, so under
        // 760px the last columns were simply clipped by the card's
        // `overflow-hidden` and unreachable by any gesture. The table already
        // carries `min-w-full` + inherited `whitespace-nowrap`, so its natural
        // content width is the right minimum — and now it actually scrolls.
        //
        // `bleed` + `[--gutter:0]` + `px-6`: the 24px gutter is paid ONCE, by the
        // scrollport, so the first glyph lines up exactly with the card header
        // title. Without `bleed` the primitive adds `sm:first:pl-1`, which pushed
        // the first column 4px past the header — the per-cell `px-6` written here
        // before never fixed it, it was a dead override (check:class-collision).
        <TelemetryScrollAffordance>
          <Table bleed dense data-scrollport className="px-6 [--gutter:--spacing(0)]">
            {/* No local rules on the head row or the body: under the collapsed
                border model the cell edge wins over the row edge, so
                `border-b border-white/5` here and `divide-y divide-white/5` on
                the body never painted a pixel — TableHead's own
                `[&_th]:border-b` and TableCell's `border-b` already draw the two
                separators, at the ONE weight the design system picked. */}
            <TableHead>
              <TableRow>
                <TableHeader>Agent</TableHeader>
                <TableHeader>Project</TableHeader>
                <TableHeader className="text-right">Events</TableHeader>
                <TableHeader className="text-right">Success Rate</TableHeader>
                <TableHeader className="text-right">Avg Latency</TableHeader>
                <TableHeader className="text-right">Last Seen</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
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
                  <TableCell>
                    {/* `pointer-coarse:` only — measured on an emulated iPhone 14
                        (390px, `(pointer: coarse)` matching), this anchor's tap box
                        was 170x17px; WCAG 2.5.5 / the platform floor is 44px, and
                        every in-table link on this page failed it (31/31). The
                        link is inline, so padding would not grow the line box and
                        would spill its hit area over the neighbouring rows —
                        `inline-flex` + the repo's `min-h-11` convention (sidebar.tsx,
                        command-palette.tsx) grows the BOX honestly instead, and the
                        row grows with it. Guarded on coarse pointers so the desktop
                        density this page is built on is untouched: with a mouse the
                        44px floor does not apply and a 17px link is precise enough. */}
                    <Link
                      href={`/admin/agents/${row.agentId}`}
                      className="text-sm font-medium text-white hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                    >
                      {copilotNameById.get(row.agentId) ?? row.agentId}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/admin/projects/${row.projectId}`}
                      className="text-xs text-zinc-300 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center"
                    >
                      {projectNameById.get(row.projectId) ?? row.projectId}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-sm font-mono tabular-nums text-white">
                      {numberFormat.format(row.totalRuns)}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
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
                  <TableCell className="text-right">
                    <span className="text-sm font-mono tabular-nums text-zinc-300">
                      {row.avgLatencyMs !== null ? formatDurationMs(row.avgLatencyMs) : <NotMeasuredDash />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="text-xs font-mono tabular-nums text-zinc-400">
                      {row.lastSeenAt !== null ? formatTimestamp(row.lastSeenAt) : <NotMeasuredDash />}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TelemetryScrollAffordance>
      )}
    </SurfaceCard>
  )
}
