import { TrophyIcon } from '@heroicons/react/24/outline'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * AgentLeaderboard — the ranked fleet standings of /admin/performance.
 * Server component: everything below derives deterministically from props.
 *
 * Contract (consumed by the Performance page refactor — do not change):
 *   <AgentLeaderboard copilots={copilots} projectNameById={projectNameById} />
 *   `copilots` arrive pre-sorted by 24h volume desc then name — that received
 *   order is only the tie-break fallback; the leaderboard re-sorts by score.
 */

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * Ranking score — volume-weighted quality.
 *
 *   score = testPassRate × ln(1 + runsLast24h)
 *
 * Rationale: a 100% pass rate over 3 runs must not outrank a 97% pass rate
 * over 900 runs. The log term rewards real traffic with strongly diminishing
 * returns, so quality (pass rate) stays the dominant factor between agents of
 * comparable volume, while volume separates agents of comparable quality.
 * Copilots whose health is not backed by real runs (healthEvidence !== 'runs')
 * get NO score (null): they are unranked, sink below every scored agent in the
 * order they were received, and render "—".
 *
 * Display: the score itself is never shown — it only drives the row order and
 * the RankBadge (#1 solid accent mark; every other rank is zinc). Never paint
 * accent-soft / accent-surface on the row — that imports a second surface.
 * Pass Rate stays zinc tabular — accent is reserved for the rank-1 mark only.
 */
function leaderboardScore(copilot: Copilot): number | null {
  // testPassRate is a PLACEHOLDER 0 when unproven (data.ts normalizeHealth) — the
  // authoritative "is it measured" signal is healthUnavailableFields, NOT
  // healthEvidence (true for a benchmark-only copilot whose testPassRate is 0).
  if (!copilot.healthUnavailableFields || copilot.healthUnavailableFields.includes('testPassRate')) {
    return null
  }
  return copilot.health.testPassRate * Math.log1p(copilot.health.runsLast24h)
}

/**
 * Rank mark — Catalyst Badge only (#1 accentSolid, else zinc).
 *
 * The three geometry utilities carry an explicit `!`: `Badge` composes
 * `clsx(className, defaults)`, so a bare `rounded-full` / `px-0` / `text-[10px]`
 * loses to the primitive's own `rounded-md` / `px-1.5` / `text-sm/5` —
 * Tailwind settles a same-property clash by the order of the COMPILED sheet, not
 * by the order of the class attribute (DESIGN-DOCTRINE §Cascade). The badge was
 * therefore rendering as a 24px rounded-md box with 6px side padding and 14px
 * digits, i.e. not the circular medallion this file describes. `Badge` exposes
 * no shape/size prop, so the documented escape hatch — a visible `!` — is the
 * only honest way to make the intent real instead of leaving three dead classes.
 * `size-6` / `justify-center` / `tabular-nums` need no marker: the primitive sets
 * none of those properties, so they ADD rather than replace.
 */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) {
    return (
      <>
        <Badge color="zinc" className="size-6 justify-center rounded-full! px-0! text-[10px]!" aria-hidden="true">
          —
        </Badge>
        <span className="sr-only">Unranked</span>
      </>
    )
  }

  return (
    <Badge
      color={rank === 1 ? 'accentSolid' : 'zinc'}
      className="size-6 justify-center rounded-full! px-0! text-[10px]! tabular-nums"
    >
      {rank}
    </Badge>
  )
}

export function AgentLeaderboard({
  copilots,
  projectNameById,
}: {
  copilots: Copilot[]
  projectNameById: Map<string, string>
}) {
  // Re-rank by score; the received order (volume desc, then name) is only the
  // tie-break and the ordering of the unranked tail.
  const rows = copilots
    .map((copilot, receivedIndex) => ({ copilot, receivedIndex, score: leaderboardScore(copilot) }))
    .sort((a, b) => {
      if (a.score === null && b.score === null) return a.receivedIndex - b.receivedIndex
      if (a.score === null) return 1
      if (b.score === null) return -1
      return b.score - a.score || a.receivedIndex - b.receivedIndex
    })
    // Every null score sorts after every real one, so index + 1 IS the rank.
    .map((entry, index) => ({ ...entry, rank: entry.score !== null ? index + 1 : null }))

  return (
    <SurfaceCard className="h-full">
      <SurfaceCardHeader
        title="Agent Leaderboard"
        className="px-4 pt-3 pb-2"
        meta={
          // zinc-400, not zinc-500: `check-contrast` measured this exact node
          // ("1 agents") at 3.59:1 against the raised plane rgb(26,26,30) for a
          // 4.5 threshold — 12px regular text is never "large text". Same call,
          // same reason as dashboard-kpi-strip.tsx.
          <span className="text-xs text-zinc-400">
            {copilots.length} agent{copilots.length === 1 ? '' : 's'}
          </span>
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          icon={TrophyIcon}
          title="No agents to rank"
          description="Provision copilots in your projects — the leaderboard ranks them as soon as they serve traffic."
        />
      ) : (
        // Scrollbar deliberately NOT hidden: `max-h-[30rem]` caps the standings, so
        // past ~10 agents the rest of the ranking is off-screen and `no-scrollbar`
        // removed the only sign that the list continues — a leaderboard that looks
        // complete but is not. The fade+ResizeObserver affordance (agent-detail-nav)
        // is horizontal-only and needs a client boundary; this table is a server
        // component, so the native bar is the honest answer.
        <div className="max-h-[30rem] overflow-auto">
          {/* `min-w` lives on THIS wrapper, not on <Table>. `fixed` renders the
              table `w-full table-fixed`, so it can never exceed its container and
              a min-width passed to the primitive would land on a div that no
              longer scrolls — inert. The wrapper is what overflows the scrollport
              above and hands the horizontal scroll back on narrow viewports. */}
          <div className="min-w-[520px]">
          {/* `fixed` is what makes the sticky header above actually stick: a
              non-fixed <Table> wraps itself in `overflow-x-auto`, and a box with
              `overflow-x: auto` computes `overflow-y` to `auto` as well, so it
              becomes a second scrollport BETWEEN the header and the scrollport
              that really scrolls (the max-h div). `position: sticky` resolves
              against the nearest such ancestor, which never scrolls vertically —
              the header stayed pinned to a box that does not move. The primitive
              documents the trap in `components/ui/table.tsx`.

              `fixed` also fixes column geometry: with auto layout the column
              edges of this table drifted with the widest agent name, so the same
              five headers landed at a different x on every dataset. Every column
              but "Agent" now declares its width, and "Agent" absorbs the rest.

              `border-collapse` dropped: the primitive puts `className` on a DIV,
              and `border-collapse` has no effect on anything but a table box —
              it was doing nothing (Tailwind preflight already collapses tables).

              `dense` replaces the `py-2` every TableCell below used to carry.
              Same cascade defect as the badge: `TableCell` composes
              `clsx(className, …, dense ? 'py-3' : 'py-4')`, so `py-2` lost to
              `py-4` and every row rendered a full 16px tall — the compact
              standings this component describes never existed. `dense` is the
              primitive's own prop for exactly this, so the value is emitted
              ONCE and there is no race left to lose. */}
          <Table fixed dense className="px-4 text-left [--gutter:--spacing(0)]">
          <TableHead className="sticky top-0 z-10">
            <TableRow className="border-b border-white/5">
              <TableHeader className="w-16">Rank</TableHeader>
              <TableHeader>Agent</TableHeader>
              <TableHeader className="w-24 text-right">Pass Rate</TableHeader>
              <TableHeader className="w-20 text-right">Runs</TableHeader>
              <TableHeader className="w-24 text-right">Cost</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {rows.map(({ copilot, rank }) => (
              // The row IS navigable, so it says so through the primitive instead of
              // faking it: `group-hover:underline` on a row with no `href` underlined
              // the agent name from anywhere in the row while only the name itself was
              // clickable. This row has exactly one destination and no competing action
              // (rank badge, avatar and the three metric cells are inert), so handing
              // `href`/`title` to TableRow makes the whole row the target and buys the
              // primitive's hover fill AND its keyboard focus ring — same shape as
              // ProjectsListView. The inner <Link> is dropped: the primitive already
              // renders the row link, and keeping both put two tab stops on the same URL.
              <TableRow
                key={copilot.id}
                href={`/admin/agents/${copilot.id}`}
                title={`Open agent ${copilot.name}`}
                className="group"
              >
                <TableCell>
                  <RankBadge rank={rank} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <CopilotAvatar copilot={copilot} className="size-7 rounded-lg" />
                    <div className="flex min-w-0 flex-col">
                      <div className="truncate text-sm font-medium text-white group-hover:underline">
                        {copilot.name}
                      </div>
                      {/* zinc-400, not zinc-500: `check-contrast` measured this exact
                          node ("agent-builder-copilot") at 3.59:1 on the raised plane
                          rgb(26,26,30) against a 4.5 threshold. `truncate` because the
                          table is now `table-fixed` — without it a long slug spills
                          into the Pass Rate column instead of ellipsing. */}
                      <span className="truncate font-mono text-[10px] text-zinc-400">{copilot.slug}</span>
                      {copilot.projectId ? (
                        // `max-w-48` dropped: under `table-fixed` the cell already
                        // bounds this line, and the extra cap stopped the ellipsis
                        // short of the column edge, leaving a ragged right margin
                        // that did not line up with the two lines above it.
                        <span className="truncate text-[10px] text-zinc-400">
                          {projectNameById.get(copilot.projectId) ?? copilot.projectId}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  {copilot.healthUnavailableFields && !copilot.healthUnavailableFields.includes('testPassRate') ? (
                    <span className="text-sm font-mono tabular-nums text-zinc-300">
                      {formatPercent(copilot.health.testPassRate)}
                    </span>
                  ) : (
                    // testPassRate is a PLACEHOLDER 0 when unproven — gate on
                    // healthUnavailableFields (authoritative), NOT healthEvidence
                    // (true for a benchmark-only copilot) nor a null check (the
                    // placeholder is 0, never null). Fabricated "0.0%" otherwise.
                    <NotMeasuredDash />
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm font-mono tabular-nums text-zinc-300">
                    {numberFormat.format(copilot.health.runsLast24h)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm font-mono tabular-nums text-zinc-400">
                    {copilot.health.runsLast24h > 0 ? formatUsd(copilot.health.costLast24hUsd) : <NotMeasuredDash />}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          </Table>
          </div>
        </div>
      )}
    </SurfaceCard>
  )
}
