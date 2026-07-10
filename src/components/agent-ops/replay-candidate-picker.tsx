'use client'

import clsx from 'clsx'
import { useState } from 'react'

import { Badge } from '@/components/catalyst/badge'
import { Text } from '@/components/catalyst/text'
import type { ReplayCandidate } from '@/lib/agent-mission-control/types'
import { ReplayComparisonTable } from './replay-comparison-table'

export interface ReplayCandidateItem {
  candidate: ReplayCandidate
  /** Resolved human label of the candidate version, e.g. "v3.0.0-beta.2". */
  versionLabel: string
}

const outcomeConfig: Record<
  ReplayCandidate['outcome'],
  { label: string; color: 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'; meterClassName: string }
> = {
  matched: { label: 'Matched', color: 'accent', meterClassName: 'bg-accent-400' },
  improved: { label: 'Improved', color: 'accent', meterClassName: 'bg-accent-400' },
  diverged: { label: 'Diverged', color: 'accentStrong', meterClassName: 'bg-accent-400' },
  unsafe: { label: 'Unsafe', color: 'accentSolid', meterClassName: 'bg-accent-400' },
  pending: { label: 'Pending', color: 'zinc', meterClassName: 'bg-zinc-500' },
}

/**
 * Selectable row of candidate sub-cards; renders the step diff table
 * for the currently selected candidate below the row.
 */
export function ReplayCandidatePicker({ items }: { items: ReplayCandidateItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(items[0]?.candidate.id ?? null)

  if (items.length === 0) {
    return <Text>No candidates queued for this replay yet.</Text>
  }

  const selected = items.find((item) => item.candidate.id === selectedId) ?? items[0]

  return (
    <div>
      <div
        role="group"
        aria-label="Replay candidates"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-4"
      >
        {items.map(({ candidate, versionLabel }) => {
          const isSelected = candidate.id === selected.candidate.id
          const outcome = outcomeConfig[candidate.outcome]
          const matchPct = candidate.matchRate === null ? null : Math.round(candidate.matchRate * 100)

          return (
            <button
              key={candidate.id}
              type="button"
              aria-pressed={isSelected}
              onClick={() => setSelectedId(candidate.id)}
              className={clsx(
                'rounded-lg p-4 text-left transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                isSelected
                  ? 'bg-zinc-100 ring-2 ring-accent-500/60 dark:bg-zinc-950'
                  : 'bg-zinc-50 ring-1 ring-zinc-950/5 hover:bg-zinc-100 hover:ring-zinc-950/10 dark:bg-zinc-950 dark:ring-white/10 dark:hover:ring-white/20'
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-sm font-medium tabular-nums text-zinc-950 dark:text-white">{versionLabel}</span>
                  <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{candidate.model}</span>
                </span>
                <Badge color={outcome.color}>{outcome.label}</Badge>
              </span>
              <span className="mt-3 flex items-center gap-3">
                <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-zinc-950/10 dark:bg-zinc-800">
                  {matchPct !== null ? (
                    <span
                      className={clsx('block h-full rounded-full', outcome.meterClassName)}
                      style={{ width: `${matchPct}%` }}
                    />
                  ) : null}
                </span>
                <span className="shrink-0 font-mono text-xs tabular-nums text-zinc-300">
                  {matchPct !== null ? `${matchPct}% match` : 'Pending'}
                </span>
              </span>
              <span className="mt-3 block text-xs text-zinc-500">{candidate.notes}</span>
              <span
                className={clsx(
                  'mt-3 flex items-center gap-1.5 text-xs font-medium',
                  isSelected ? 'text-accent-700 dark:text-accent-400' : 'text-zinc-500'
                )}
              >
                {isSelected ? (
                  <>
                    <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-accent-500" />
                    Viewing step diff
                  </>
                ) : (
                  <span className="underline decoration-zinc-400/50 underline-offset-2">View step diff</span>
                )}
              </span>
            </button>
          )
        })}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="text-sm font-medium text-zinc-950 dark:text-white">
            Step diff — <span className="font-mono tabular-nums">{selected.versionLabel}</span>
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              {' '}
              on <span className="font-mono text-xs">{selected.candidate.model}</span>
            </span>
          </h4>
          <p className="text-xs text-zinc-500">Expected = production run · Actual = candidate replay</p>
        </div>
        <div className="mt-3 border-t border-zinc-950/5 pt-2 dark:border-white/5">
          <ReplayComparisonTable candidate={selected.candidate} />
        </div>
      </div>
    </div>
  )
}
