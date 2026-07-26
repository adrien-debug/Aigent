import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

import { NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { RunStatusText } from '@/components/agent-ops/run-detail-panel'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
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
 * row is a canon `border-b border-white/5` hairline (no background wash), and "Started" reads
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
        className="px-4 pt-3 pb-2"
        // zinc-400, not zinc-500: `check-contrast` measured the identical node in
        // AgentLeaderboard's header (same class, same raised plane rgb(26,26,30),
        // same 12px regular weight) at 3.59:1 for a 4.5 threshold.
        meta={<span className="text-xs text-zinc-400">{runs.length} runs · all projects</span>}
      />
      {/* Scrollbar deliberately NOT hidden. This scrollport clips on BOTH axes —
          `max-h-[28rem]` hides rows, `min-w-[760px]` hides columns under 760px — and
          `no-scrollbar` removed every hint that either was happening. The
          fade+ResizeObserver affordance (agent-detail-nav) is horizontal-only and
          needs a client boundary; this table is a server component, so the native
          bar is the cheaper honest answer and it covers both axes at once. */}
      <div className="max-h-[28rem] overflow-auto">
        {/* `min-w` moved from <Table> to THIS wrapper. `fixed` renders the table
            `w-full table-fixed`, which can never exceed its container, so a
            min-width handed to the primitive would land on a div that no longer
            scrolls — inert. The wrapper is what overflows the scrollport above
            and gives the horizontal scroll back under 900px. 900 rather than the
            previous 760: eight columns with declared widths need the extra room
            before "Run & Copilot" is squeezed to nothing. */}
        <div className="min-w-[900px]">
        {/* `fixed` is what makes the sticky header below actually stick. A
            non-fixed <Table> wraps itself in `overflow-x-auto`, and a box with
            `overflow-x: auto` computes `overflow-y` to `auto` too — so it became
            a second scrollport sitting BETWEEN the header and the scrollport that
            really scrolls (the max-h div above). `position: sticky` resolves
            against the nearest such ancestor, and that one never scrolls
            vertically: the header was pinned to a box that does not move. The
            primitive documents the trap in `components/ui/table.tsx`.

            The scrollport above still clips BOTH axes, so the honest scrollbars
            the comment below asks for are unchanged.

            `fixed` also stabilises the column edges: under auto layout they moved
            with the longest copilot name, so the same eight headers landed at a
            different x on every render. Every column but "Run & Copilot" now
            declares its width and that one absorbs the remainder.

            `dense` replaces the `py-2` every TableCell carried: back when
            `TableCell` composed `clsx(className, …, dense ? 'py-3' : 'py-4')`,
            `py-2` lost to `py-4` and the rows rendered 16px tall — the compact
            feed described above never existed. The primitives now compose
            `cn(defaults, className)` and a per-cell `py-*` would land, but
            density is a property of the TABLE: `dense` still emits it once
            instead of repeating it on every cell.

            `border-collapse` dropped: `className` lands on a DIV here, and the
            property means nothing outside a table box (Tailwind preflight already
            collapses tables). It was a dead class. */}
        <Table fixed dense className="px-4 text-left [--gutter:--spacing(0)]">
        <TableHead className="sticky top-0 z-10">
          <TableRow className="border-b border-white/5">
            <TableHeader>Run & Copilot</TableHeader>
            <TableHeader className="w-28">Project</TableHeader>
            <TableHeader className="w-32">Status</TableHeader>
            <TableHeader className="w-1/4">Input Summary</TableHeader>
            <TableHeader className="w-20 text-right">Latency</TableHeader>
            <TableHeader className="w-20 text-right">Cost</TableHeader>
            <TableHeader className="w-24 text-right">Started</TableHeader>
            <TableHeader className="w-10 text-center">
              <span className="sr-only">Trace</span>
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y divide-white/5">
          {runs.map((run) => {
            const copilot = copilotById.get(run.copilotId)
            return (
              // No `group` / no row-level hover: the row is NOT navigable and cannot
              // be — the last cell holds an INDEPENDENT external action (the trace
              // link), which a full-row overlay link would swallow, and several cells
              // carry their own `title` tooltip. `group-hover:underline` underlined
              // the run link from anywhere in the row, promising a row-wide click
              // target that does not exist; the underline now follows the pointer
              // only over the link itself, which also gets the focus ring the row no
              // longer provides.
              <TableRow key={run.id}>
                <TableCell>
                  <div className="flex min-w-0 flex-col">
                    {/* `-my-3 py-3`: this link is the ONLY way into a run — the row
                        is deliberately not navigable (see above) — and it measured
                        99×20px, i.e. 20px of touch height against the 44px floor.
                        The padding grows the hit box to 44px and the equal negative
                        margin gives the space straight back, so the row keeps the
                        49px it had and the text does not move by a pixel (measured
                        on /admin/performance at 390px, before/after). `block` +
                        `truncate` are preserved: a flex box would kill the ellipsis
                        the fixed column layout depends on. */}
                    <Link
                      href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                      title={run.id}
                      className="-my-3 block truncate rounded py-3 text-sm font-medium text-white hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                    >
                      {copilot?.name ?? run.copilotId}
                    </Link>
                  </div>
                </TableCell>
                {/* `truncate` on the CELL, not on the span inside it: under
                    `table-fixed` a cell no longer grows to fit its content, so
                    without an ellipsis a long project name simply painted over the
                    Status column. Nothing here needs an `!`: `overflow` /
                    `text-overflow` are properties `TableCell` sets nowhere, so
                    they ADD rather than replace — and since the primitives moved
                    to `cn(defaults, className)` even a REPLACING class would win
                    on its own (tailwind-merge drops the loser). */}
                <TableCell className="truncate">
                  {copilot?.projectId ? (
                    <span className="text-xs text-zinc-400">
                      {projectNameById.get(copilot.projectId) ?? <NotMeasuredDash />}
                    </span>
                  ) : (
                    <NotMeasuredDash />
                  )}
                </TableCell>
                <TableCell className="truncate">
                  <RunStatusText status={run.status} />
                </TableCell>
                <TableCell>
                  {/* `max-w-md` dropped: the 1/4 column is now the bound, and the
                      extra 28rem cap cut the ellipsis short of the column edge —
                      a ragged right margin that did not line up with the header
                      above it or the rows around it. */}
                  <span className="block truncate text-xs text-zinc-400" title={run.inputSummary}>
                    {run.inputSummary}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs text-zinc-300 tabular-nums">
                    {formatDurationMs(run.latencyMs)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="font-mono text-xs text-zinc-400 tabular-nums">
                    {run.costUsd === null ? <NotMeasuredDash /> : formatUsd(run.costUsd)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  {/* zinc-400, not zinc-500: `check-contrast` measured this class at
                      12px regular on the raised plane rgb(26,26,30) at 3.59:1 for a
                      4.5 threshold (same node shape as AgentLeaderboard's slug). A
                      timestamp is data, not decoration — it has to clear AA. */}
                  <span
                    className="font-mono text-xs whitespace-nowrap text-zinc-400 tabular-nums"
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
                    // The run produced no trace URL — an observability artefact that
                    // was never captured, so "not measured" is the truthful reading.
                    // The bare dash was silent: in an icon-only column the screen
                    // reader announced an empty cell with no clue why.
                    <NotMeasuredDash />
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
        </Table>
        </div>
      </div>
    </SurfaceCard>
  )
}
