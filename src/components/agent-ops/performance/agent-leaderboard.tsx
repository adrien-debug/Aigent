import { TrophyIcon } from '@heroicons/react/24/outline'
import clsx from 'clsx'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
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

/** Pass rates at or above this read as "healthy" and take the accent tone. */
const PASS_RATE_ACCENT_THRESHOLD = 0.9

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
 * Display: the raw score is unbounded, so the UI shows a relative index
 * normalized to the current fleet leader (leader = 100). The meter under the
 * number uses the same normalization, so digit and bar always agree.
 */
function leaderboardScore(copilot: Copilot): number | null {
  if (copilot.healthEvidence !== 'runs') return null
  return copilot.health.testPassRate * Math.log1p(copilot.health.runsLast24h)
}

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

const STATUS_PILL_BASE =
  'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md ring-1 text-[10px] font-medium uppercase tracking-widest'

/** Accent = live/attention (label carries meaning), zinc = neutral/inactive. */
function StatusPill({ label, tone }: { label: string; tone: 'accent' | 'zinc' }) {
  return (
    <span
      className={`${STATUS_PILL_BASE} ${
        tone === 'accent'
          ? 'text-accent-300 bg-[var(--accent-surface)] ring-[var(--accent-line)]'
          : 'text-zinc-400 bg-white/5 ring-white/10'
      }`}
    >
      {label}
    </span>
  )
}

/**
 * Round rank marker. ONE accent, escalation by intensity only (doctrine):
 * #1 = solid accent (Badge accentSolid recipe), #2–3 = soft accent surface,
 * the rest = zinc. Unranked (no run evidence) shows a muted dash.
 */
function RankBadge({ rank }: { rank: number | null }) {
  if (rank === null) {
    return (
      <>
        <span
          aria-hidden="true"
          className="inline-flex size-7 items-center justify-center rounded-full bg-white/5 text-xs font-semibold text-zinc-500 ring-1 ring-white/10 ring-inset"
        >
          —
        </span>
        <span className="sr-only">Unranked</span>
      </>
    )
  }

  return (
    <span
      className={clsx(
        'inline-flex size-7 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
        rank === 1
          ? 'bg-accent-600 text-zinc-950 shadow-sm'
          : rank <= 3
            ? 'bg-[var(--accent-surface)] text-accent-300 ring-1 ring-[var(--accent-line)] ring-inset'
            : 'bg-white/5 text-zinc-400 ring-1 ring-white/10 ring-inset'
      )}
    >
      {rank}
    </span>
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

  const maxScore = rows.reduce((max, r) => (r.score !== null && r.score > max ? r.score : max), 0)
  const scoreIndexOf = (score: number) => (maxScore > 0 ? Math.round((score / maxScore) * 100) : 0)

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
          <Table className="w-full text-left border-collapse min-w-[960px]">
            <TableHead>
              <TableRow className="border-b border-white/5 bg-black/20">
                <TableHeader className="px-6 w-14">Rank</TableHeader>
                <TableHeader className="px-6">Agent</TableHeader>
                <TableHeader className="px-6">Project</TableHeader>
                <TableHeader className="px-6">Status</TableHeader>
                <TableHeader className="px-6 text-right">Score</TableHeader>
                <TableHeader className="px-6 text-right">Pass Rate</TableHeader>
                <TableHeader className="px-6 text-right">24h Runs</TableHeader>
                <TableHeader className="px-6 text-right">24h Cost</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody className="divide-y divide-white/5">
              {rows.map(({ copilot, score, rank }) => (
                <TableRow
                  key={copilot.id}
                  className={clsx(
                    'group hover:bg-[var(--color-surface-interactive)] transition-colors',
                    // Podium wash — subtle, hover still wins (pseudo-class specificity).
                    rank !== null && rank <= 3 && 'bg-[var(--accent-soft)]'
                  )}
                >
                  <TableCell className="py-4 px-6">
                    <RankBadge rank={rank} />
                  </TableCell>
                  <TableCell className="py-4 px-6">
                    <div className="flex items-center gap-3">
                      <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
                      <div className="flex flex-col">
                        <Link
                          href={`/admin/agents/${copilot.id}`}
                          className="text-sm font-medium text-white group-hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                        >
                          {copilot.name}
                        </Link>
                        <span className="text-[10px] font-mono text-zinc-500 mt-0.5">{copilot.slug}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="py-4 px-6">
                    {copilot.projectId ? (
                      <Link
                        href={`/admin/projects/${copilot.projectId}`}
                        className="text-xs text-zinc-300 hover:underline rounded focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
                      >
                        {projectNameById.get(copilot.projectId) ?? copilot.projectId}
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 px-6">
                    <StatusPill
                      label={statusLabel(copilot.displayStatus ?? copilot.status)}
                      tone={
                        copilot.displayStatus === 'production' ||
                        copilot.status === 'active' ||
                        copilot.status === 'degraded'
                          ? 'accent'
                          : 'zinc'
                      }
                    />
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    {score !== null ? (
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-mono tabular-nums text-white">{scoreIndexOf(score)}</span>
                        <div className="w-16">
                          <LinearMeter
                            value={score}
                            max={maxScore}
                            size="xs"
                            tone="accent"
                            ariaLabel={`Leaderboard score ${scoreIndexOf(score)} out of 100`}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    {copilot.healthEvidence === 'runs' ? (
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={clsx(
                            'text-sm font-mono tabular-nums',
                            copilot.health.testPassRate >= PASS_RATE_ACCENT_THRESHOLD
                              ? 'text-accent-400'
                              : 'text-zinc-300'
                          )}
                        >
                          {formatPercent(copilot.health.testPassRate)}
                        </span>
                        <div className="w-16">
                          <LinearMeter
                            value={copilot.health.testPassRate}
                            max={1}
                            size="xs"
                            tone={copilot.health.testPassRate >= PASS_RATE_ACCENT_THRESHOLD ? 'accent' : 'zinc'}
                            ariaLabel={`Pass rate ${formatPercent(copilot.health.testPassRate)}`}
                          />
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
                    <span className="text-sm font-mono tabular-nums text-white">
                      {numberFormat.format(copilot.health.runsLast24h)}
                    </span>
                  </TableCell>
                  <TableCell className="py-4 px-6 text-right">
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
