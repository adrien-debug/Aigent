'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import { useState } from 'react'

import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { SplitBar, type SplitSegment } from '@/components/agent-ops/widgets/split-bar'
import { Badge } from '@/components/catalyst/badge'
import { Subheading } from '@/components/catalyst/heading'
import { Text } from '@/components/catalyst/text'
import { REPLAY_OUTCOME_LABELS } from '@/lib/agent-mission-control/labels'
import type { ReplayCandidate } from '@/lib/agent-mission-control/types'
import { ReplayComparisonTable } from './replay-comparison-table'

export interface ReplayCandidateItem {
  candidate: ReplayCandidate
  /** Resolved human label of the candidate version, e.g. "v3.0.0-beta.2". */
  versionLabel: string
}

const outcomeConfig: Record<
  ReplayCandidate['outcome'],
  { label: string; color: 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'; meterTone: 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'; splitTone: SplitSegment['tone'] }
> = {
  matched: { label: REPLAY_OUTCOME_LABELS.matched, color: 'accent', meterTone: 'accent', splitTone: 'accent-400' },
  improved: { label: REPLAY_OUTCOME_LABELS.improved, color: 'accent', meterTone: 'accent', splitTone: 'accent-500' },
  diverged: { label: REPLAY_OUTCOME_LABELS.diverged, color: 'accentStrong', meterTone: 'accentStrong', splitTone: 'accent-600' },
  unsafe: { label: REPLAY_OUTCOME_LABELS.unsafe, color: 'accentSolid', meterTone: 'accentSolid', splitTone: 'accent-700' },
  pending: { label: REPLAY_OUTCOME_LABELS.pending, color: 'zinc', meterTone: 'zinc', splitTone: 'zinc' },
}

const OUTCOME_ORDER: ReplayCandidate['outcome'][] = ['matched', 'improved', 'diverged', 'unsafe', 'pending']

const verdictOrder = [
  { key: 'match', label: 'Match', tone: 'accent-400' as const },
  { key: 'acceptable-diff', label: 'Acceptable diff', tone: 'zinc' as const },
  { key: 'divergence', label: 'Divergence', tone: 'accent-600' as const },
  { key: 'unsafe', label: 'Unsafe', tone: 'accent-700' as const },
]

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

  // Candidate-outcome mix for this comparison (derived from props, no fetch).
  const outcomeSegments: SplitSegment[] = OUTCOME_ORDER.map((outcome) => ({
    key: outcome,
    label: outcomeConfig[outcome].label,
    value: items.filter((item) => item.candidate.outcome === outcome).length,
    tone: outcomeConfig[outcome].splitTone,
  })).filter((segment) => segment.value > 0)

  // Verdict mix of the selected candidate's replayed steps.
  const verdictSegments: SplitSegment[] = verdictOrder.map((verdict) => ({
    key: verdict.key,
    label: verdict.label,
    value: selected.candidate.steps.filter((step) => step.verdict === verdict.key).length,
    tone: verdict.tone,
  }))

  return (
    <div>
      {/* Divergence-as-split-bar: how this comparison's candidates landed */}
      {items.length > 1 ? (
        <div className="mb-4">
          <SplitBar segments={outcomeSegments} />
        </div>
      ) : null}

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
            <Headless.Button
              key={candidate.id}
              aria-pressed={isSelected}
              onClick={() => setSelectedId(candidate.id)}
              className={clsx(
                'w-full rounded-lg p-4 text-left transition-colors duration-150',
                'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
                isSelected
                  ? 'bg-[var(--color-surface-interactive)] ring-2 ring-[var(--accent-line-strong)]'
                  : 'bg-[var(--color-surface-secondary)] ring-1 ring-white/5 hover:bg-[var(--color-surface-interactive)] hover:ring-white/10'
              )}
            >
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex min-w-0 items-baseline gap-2">
                  <span className="font-mono text-sm font-medium tabular-nums text-zinc-950 dark:text-white">{versionLabel}</span>
                  <span className="truncate font-mono text-xs text-zinc-500 dark:text-zinc-400">{candidate.model}</span>
                </span>
                <Badge color={outcome.color}>{outcome.label}</Badge>
              </span>
              <span className="mt-3 block">
                <LinearMeter
                  value={candidate.matchRate ?? 0}
                  max={1}
                  tone={outcome.meterTone}
                  valueText={matchPct !== null ? `${matchPct}% match` : 'Pending'}
                  ariaLabel={`Match rate for ${versionLabel}`}
                />
              </span>
              <span className="mt-3 block text-xs text-zinc-500">{candidate.notes}</span>
            </Headless.Button>
          )
        })}
      </div>

      <div className="mt-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Subheading level={4}>
            Step diff — <span className="font-mono tabular-nums">{selected.versionLabel}</span>
            <span className="font-normal text-zinc-500 dark:text-zinc-400">
              {' '}
              on <span className="font-mono text-xs">{selected.candidate.model}</span>
            </span>
          </Subheading>
          <p className="text-xs text-zinc-500">Expected = production run · Actual = candidate replay</p>
        </div>
        {selected.candidate.steps.length > 0 ? (
          <div className="mt-3">
            <SplitBar segments={verdictSegments} />
          </div>
        ) : null}
        <div className="mt-3 border-t border-zinc-950/5 pt-2 dark:border-white/5">
          <ReplayComparisonTable candidate={selected.candidate} />
        </div>
      </div>
    </div>
  )
}
