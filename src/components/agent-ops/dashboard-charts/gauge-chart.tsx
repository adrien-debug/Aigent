'use client'

/**
 * Radial gauge — a ratio (N of M, or a raw percent) as a donut arc instead of
 * prose. Recharts is the standard engine per the Hearst global doctrine
 * (§Graphiques), same family as `chart-primitives.tsx`'s bar/area charts;
 * this fills the "single ratio" shape neither of those covers.
 *
 * Colours come from the `--chart-*`/`--state-danger-*` tokens, never a
 * literal hex, so `npm run check:ds` keeps holding.
 */
import { Cell, Pie, PieChart, ResponsiveContainer } from 'recharts'

const TRACK = 'var(--color-zinc-800)'
const POSITIVE = 'var(--chart-success)'
const NEGATIVE = 'var(--state-danger-solid)'
const NEUTRAL = 'var(--color-zinc-400)'

export function GaugeChart({
  value,
  max,
  label,
  tone = 'positive',
  size = 96,
  ariaLabel,
}: {
  /** Achieved amount — checks passing, percent points, etc. */
  value: number
  /** Total the gauge is measured against. 0 renders an empty track, never NaN. */
  max: number
  /** Big centred readout — e.g. "7/9" or "94%". Text still carries the meaning. */
  label: string
  /** `positive` = accent/success role, `negative` = danger role (failure/destruction
   * only, per doctrine), `neutral` = an incomplete-but-not-broken ratio — never
   * paint "not yet done" with the danger colour. */
  tone?: 'positive' | 'negative' | 'neutral'
  /** Pixel diameter of the plot. */
  size?: number
  ariaLabel: string
}) {
  const clamped = max > 0 ? Math.max(0, Math.min(value, max)) : 0
  const remainder = Math.max(max - clamped, 0)
  const data = max > 0 ? [{ v: clamped }, { v: remainder }] : [{ v: 1 }]
  const fill = tone === 'positive' ? POSITIVE : tone === 'negative' ? NEGATIVE : NEUTRAL

  return (
    <div role="img" aria-label={ariaLabel} className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="v"
            innerRadius="72%"
            outerRadius="100%"
            startAngle={90}
            endAngle={-270}
            stroke="none"
            isAnimationActive={false}
          >
            {max > 0 ? (
              <>
                <Cell fill={fill} />
                <Cell fill={TRACK} />
              </>
            ) : (
              <Cell fill={TRACK} />
            )}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="font-mono text-sm font-medium tabular-nums text-white">{label}</span>
      </div>
    </div>
  )
}
