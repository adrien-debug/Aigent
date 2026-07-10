import clsx from 'clsx'

type LinearTone = 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'

const fillTone: Record<LinearTone, string> = {
  accent: 'bg-accent-500 dark:bg-accent-400',
  accentStrong: 'bg-accent-600 dark:bg-accent-500',
  accentSolid: 'bg-accent-700 dark:bg-accent-600',
  zinc: 'bg-zinc-500 dark:bg-zinc-400',
}

/**
 * LinearMeter — one horizontal capacity/ratio bar (value against a ceiling, or
 * a 0..1 rate). The rail is a rounded-full PILL (a meter TRACK, the sanctioned
 * box-in-box exception), never a nested surface. Server-safe: no hooks, width
 * is deterministic from props.
 */
export function LinearMeter({
  value,
  max = 1,
  label,
  valueText,
  tone = 'accent',
  size = 'sm',
  ariaLabel,
}: {
  value: number
  max?: number
  label?: string
  /** Preformatted display, e.g. `formatUsd(...)` or "84%". */
  valueText?: string
  tone?: LinearTone
  /** xs = h-1 (table cells), sm = h-2 (bands). */
  size?: 'xs' | 'sm'
  ariaLabel?: string
}) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0

  return (
    <div>
      {label || valueText ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? <span className="text-xs text-zinc-500">{label}</span> : <span />}
          {valueText ? (
            <span className="font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">{valueText}</span>
          ) : null}
        </div>
      ) : null}
      <div
        role="meter"
        aria-label={ariaLabel ?? label}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuemin={0}
        aria-valuemax={max}
        className={clsx(
          'w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800',
          label || valueText ? 'mt-1.5' : undefined,
          size === 'xs' ? 'h-1' : 'h-2'
        )}
      >
        <div
          className={clsx(
            'h-full rounded-full transition-[width] duration-300 ease-out motion-reduce:transition-none',
            fillTone[tone]
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
