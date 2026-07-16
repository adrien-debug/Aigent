import clsx from 'clsx'

type RadialTone = 'accent' | 'accentStrong' | 'accentSolid'

const arcTone: Record<RadialTone, string> = {
  accent: 'text-accent-500 dark:text-accent-400',
  accentStrong: 'text-accent-600 dark:text-accent-500',
  accentSolid: 'text-accent-700 dark:text-accent-600',
}

/**
 * RadialMeter — compact ring gauge for a single 0..1 (or n/total) score with
 * the value centered. Optional `segments` renders a segmented ring (e.g. 5 for
 * a completeness score). Pure server SVG, deterministic dash offset from props,
 * strokes via currentColor on accent/zinc text wrappers (no raw hex).
 */
export function RadialMeter({
  value,
  max = 1,
  size = 96,
  strokeWidth = 6,
  tone = 'accent',
  centerText,
  caption,
  segments,
  ariaLabel,
}: {
  value: number
  max?: number
  size?: number
  strokeWidth?: number
  tone?: RadialTone
  centerText?: string
  caption?: string
  segments?: number
  ariaLabel: string
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const radius = (size - strokeWidth) / 2
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * radius
  const display = centerText ?? `${Math.round(ratio * 100)}%`

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        role="meter"
        aria-label={ariaLabel}
        aria-valuenow={Math.round(value * 100) / 100}
        aria-valuemin={0}
        aria-valuemax={max}
        className="relative"
        style={{ width: size, height: size }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          {segments && segments > 0 ? (
            <SegmentedRing
              cx={cx}
              cy={cy}
              radius={radius}
              strokeWidth={strokeWidth}
              circumference={circumference}
              segments={segments}
              filled={Math.round(ratio * segments)}
              toneClass={arcTone[tone]}
            />
          ) : (
            <>
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                className="text-zinc-200 dark:text-zinc-800"
                stroke="currentColor"
              />
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill="none"
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                stroke="currentColor"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - ratio)}
                className={clsx(
                  arcTone[tone],
                  'transition-[stroke-dashoffset] duration-300 ease-out motion-reduce:transition-none'
                )}
              />
            </>
          )}
        </svg>
        <span className="absolute inset-0 flex items-center justify-center font-mono text-sm text-zinc-950 tabular-nums dark:text-white">
          {display}
        </span>
      </div>
      {/* Cap the caption to the ring width so a long caption wraps instead of
          widening this centered column — otherwise the ring shifts off-axis
          relative to a sibling ring with a shorter caption. */}
      {caption ? (
        <span className="text-center text-xs text-balance text-zinc-500" style={{ maxWidth: size }}>
          {caption}
        </span>
      ) : null}
    </div>
  )
}

function SegmentedRing({
  cx,
  cy,
  radius,
  strokeWidth,
  circumference,
  segments,
  filled,
  toneClass,
}: {
  cx: number
  cy: number
  radius: number
  strokeWidth: number
  circumference: number
  segments: number
  filled: number
  toneClass: string
}) {
  const gap = circumference * 0.02
  const seg = circumference / segments - gap
  return (
    <>
      {Array.from({ length: segments }).map((_, i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={`${seg} ${circumference - seg}`}
          strokeDashoffset={-(i * (seg + gap))}
          className={clsx(
            i < filled ? toneClass : 'text-zinc-200 dark:text-zinc-800',
            'transition-[stroke] duration-300 ease-out motion-reduce:transition-none'
          )}
        />
      ))}
    </>
  )
}
