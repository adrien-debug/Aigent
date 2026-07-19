import { TrophyIcon } from '@heroicons/react/24/outline'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
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
  if (copilot.healthEvidence !== 'runs') return null
  return copilot.health.testPassRate * Math.log1p(copilot.health.runsLast24h)
}

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Rank mark — Catalyst Badge only (#1 accentSolid, else zinc). */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) {
    return (
      <>
        <Badge color="zinc" className="size-6 justify-center rounded-full px-0 text-[10px]" aria-hidden="true">
          —
        </Badge>
        <span className="sr-only">Unranked</span>
      </>
    )
  }

  return (
    <Badge
      color={rank === 1 ? 'accentSolid' : 'zinc'}
      className="size-6 justify-center rounded-full px-0 text-[10px] tabular-nums"
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
    <SurfaceCard>
      <SurfaceCardHeader
        title="Agent Leaderboard"
        meta={
          <span className="text-xs text-zinc-500">
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
        <div className="overflow-x-auto no-scrollbar">
          {/* px-6 + gutter 0 = canon in-card Table (same as project agents). */}
          <Table className="min-w-[720px] w-full border-collapse px-6 text-left [--gutter:--spacing(0)]">
          <TableHead>
            <TableRow className="border-b border-white/5">
              <TableHeader className="w-16">Rank</TableHeader>
              <TableHeader>Agent</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="text-right">Pass Rate</TableHeader>
              <TableHeader className="text-right">24h Runs</TableHeader>
              <TableHeader className="text-right">24h Cost</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {rows.map(({ copilot, rank }) => (
              <TableRow key={copilot.id} className="group">
                <TableCell>
                  <RankBadge rank={rank} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <Link
                        href={`/admin/agents/${copilot.id}`}
                        className="truncate text-sm font-medium text-white group-hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                      >
                        {copilot.name}
                      </Link>
                      <span className="font-mono text-[10px] text-zinc-500">{copilot.slug}</span>
                      {copilot.projectId ? (
                        <span className="truncate text-[10px] text-zinc-500">
                          {projectNameById.get(copilot.projectId) ?? copilot.projectId}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    color={
                      copilot.displayStatus === 'production' ||
                      copilot.status === 'active' ||
                      copilot.status === 'degraded'
                        ? 'accent'
                        : 'zinc'
                    }
                    className="uppercase tracking-widest"
                  >
                    {statusLabel(copilot.displayStatus ?? copilot.status)}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {copilot.healthEvidence === 'runs' ? (
                    <span className="text-sm font-mono tabular-nums text-zinc-300">
                      {formatPercent(copilot.health.testPassRate)}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm font-mono tabular-nums text-zinc-300">
                    {numberFormat.format(copilot.health.runsLast24h)}
                  </span>
                </TableCell>
                <TableCell className="text-right">
                  <span className="text-sm font-mono tabular-nums text-zinc-400">
                    {copilot.health.runsLast24h > 0 ? formatUsd(copilot.health.costLast24hUsd) : '—'}
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
