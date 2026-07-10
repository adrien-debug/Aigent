import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'

type Policy = 'never' | 'risky-only' | 'always'

const policyMeta: Record<Policy, { label: string; activeIndex: number | null; fill: string }> = {
  // 'never' = autonomous → all three notches faint (no confirmation gate).
  never: { label: 'Never', activeIndex: null, fill: '' },
  'risky-only': { label: 'Risky only', activeIndex: 1, fill: 'bg-accent-500 dark:bg-accent-400' },
  always: { label: 'Always', activeIndex: 2, fill: 'bg-accent-700 dark:bg-accent-600' },
}

/**
 * PolicyStateIndicator — a 3-notch inline state track (never · risky-only ·
 * always) with the active notch filled at escalating accent intensity and the
 * others as faint zinc ticks. Replaces the Badge + prose sentence with one
 * self-explaining line. Meaning never rides on fill alone — a text label always
 * spells the policy. Server-safe.
 */
export function PolicyStateIndicator({
  policy,
  alwaysConfirmCount,
}: {
  policy: Policy
  alwaysConfirmCount?: number
}) {
  const meta = policyMeta[policy]

  return (
    <div className="flex items-center gap-3">
      <div
        className="flex flex-1 items-center gap-1.5"
        role="img"
        aria-label={`Confirmation policy: ${meta.label}`}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={clsx(
              'h-1.5 flex-1 rounded-full',
              meta.activeIndex === i ? meta.fill : 'bg-zinc-200 dark:bg-zinc-800'
            )}
          />
        ))}
      </div>
      <span className="text-xs font-medium text-accent-600 dark:text-accent-400">{meta.label}</span>
      {alwaysConfirmCount && alwaysConfirmCount > 0 ? (
        <Badge color="zinc" className="font-mono tabular-nums">
          +{alwaysConfirmCount} pinned
        </Badge>
      ) : null}
    </div>
  )
}
