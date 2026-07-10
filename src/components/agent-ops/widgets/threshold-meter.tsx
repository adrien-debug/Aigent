import clsx from 'clsx'

/**
 * ThresholdMeter — a LinearMeter with a promotion/pass GATE marker. It renders a
 * value fill PLUS a vertical threshold tick and a pass/below state label, so it
 * reads "value vs required gate" at a glance (replay match gates, the promotion
 * gate, the shadow-experiment agreement gate). No existing widget draws the gate
 * line, which is load-bearing signal here ("Below threshold, needs ≥ X").
 *
 * The rail is a rounded-full PILL (a meter TRACK — the sanctioned box-in-box
 * exception), the tick is a 1px hairline (not a box). Server-safe: no hooks,
 * width and tick offset are deterministic from props. Monochrome accent+zinc
 * only — no raw hex, no second hue; the state LABEL carries pass/below meaning.
 * Header mirrors LinearMeter so it drops in wherever LinearMeter is used.
 */
export function ThresholdMeter({
  value,
  threshold,
  max = 1,
  valueText,
  thresholdText,
  label,
  size = 'sm',
  ariaLabel,
}: {
  value: number
  threshold: number
  max?: number
  /** Preformatted value display, e.g. "84%" or formatPercent(rate). */
  valueText?: string
  /** Preformatted threshold display, shown in the state line and gate caption. */
  thresholdText?: string
  label?: string
  /** xs = h-1 (table cells), sm = h-2 (bands). */
  size?: 'xs' | 'sm'
  ariaLabel: string
}) {
  const safeMax = max > 0 ? max : 1
  const pct = Math.min(100, Math.max(0, (value / safeMax) * 100))
  const thresholdPct = Math.min(100, Math.max(0, (threshold / safeMax) * 100))
  const meets = value >= threshold
  const gateLabel = thresholdText ?? String(threshold)

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
        aria-label={ariaLabel}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        className={clsx('relative', label || valueText ? 'mt-1.5' : undefined)}
      >
        <div
          className={clsx(
            'w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800',
            size === 'xs' ? 'h-1' : 'h-2'
          )}
        >
          <div
            className={clsx(
              'h-full rounded-full bg-accent-500 transition-[width] duration-300 ease-out motion-reduce:transition-none dark:bg-accent-400'
            )}
            style={{ width: `${pct}%` }}
          />
        </div>
        {/* Gate tick — a 1px hairline, not a box */}
        <div
          aria-hidden="true"
          className="absolute -top-1 -bottom-1 w-px bg-zinc-950/40 dark:bg-white/40"
          style={{ left: `${thresholdPct}%` }}
        />
      </div>

      <p
        className={clsx(
          'mt-1.5 text-xs',
          meets ? 'text-accent-600 dark:text-accent-400' : 'text-accent-700 dark:text-accent-500'
        )}
      >
        {meets ? 'Meets threshold' : `Below (needs ≥ ${gateLabel})`}
      </p>
    </div>
  )
}
