import { UNAVAILABLE } from './ring-gauge'

/**
 * `ArcGauge` — the compact 180° gauge that sits at the right of a KPI card.
 *
 * PURE SERVER-RENDERED SVG, like every chart in this console: no dependency, no
 * `'use client'`, no DOM measurement, no JS-driven animation.
 *
 * NOT A SPARKLINE. A sparkline plots a SERIES over time and is explicitly banned
 * from cards and table rows here. This plots ONE current value against its
 * maximum — a gauge, which is what the reference frame shows beside a KPI figure.
 * If you ever find yourself passing an array to this component, you are building
 * the banned thing.
 *
 * TRUTH — identical rules to `RingGauge`:
 *   · `value === null` (or non-finite) → NO ARC. The track alone, drawn DASHED.
 *   · `value === 0` → also no arc (a zero-length arc with a round cap renders a
 *     misleading dot), but the track stays SOLID. The dashed-vs-solid track is
 *     what keeps "never measured" visually distinct from "measured zero" at a
 *     size far too small for a word.
 *   · the KPI card next to it carries the figure — including "Indisponible" when
 *     there is none. This gauge never invents one.
 *
 * `value` is ALREADY expressed in `max` units. Nothing here multiplies it.
 */

/** Rough advance width of one glyph, as a fraction of the font size. */
const GLYPH_WIDTH_RATIO = 0.62

export type ArcGaugeProps = {
  /** Value in `max` units. `null` ⇒ never measured ⇒ no arc, dashed track. */
  value: number | null
  /** Top of the scale. A percentage gauge keeps the default 100. */
  max?: number
  /** Gauge WIDTH in px. The drawn height is roughly half of it. */
  size?: number
  /** Required: the gauge carries no visible text by default, so this is its only voice. */
  ariaLabel: string
  /** Opt-in tiny `value/max` caption under the arc. Off by default — the KPI card
   *  already shows the figure and repeating it doubles the ink for nothing. */
  showValueCaption?: boolean
}

/** Integers stay integers; anything else keeps one decimal. */
function formatFigure(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

export function ArcGauge({
  value,
  max = 100,
  size = 72,
  ariaLabel,
  showValueCaption = false,
}: ArcGaugeProps) {
  // ── Measurement ────────────────────────────────────────────────────────────
  const measuredValue = value !== null && Number.isFinite(value) ? value : null
  const scaleMax = Number.isFinite(max) && max > 0 ? max : null
  const hasMeasurement = measuredValue !== null && scaleMax !== null

  // ── Geometry: a semicircle opening upwards, drawn left → right ─────────────
  const width = Math.max(36, Math.round(Number.isFinite(size) ? size : 72))
  const strokeWidth = Math.max(4, Math.round(width * 0.11))
  const centreX = width / 2
  const radius = (width - strokeWidth) / 2
  const baselineY = centreX // the arc's flat side sits at y = radius + stroke/2
  const semicircleLength = Math.PI * radius

  // Clamped so an out-of-range value cannot produce broken geometry; the caption,
  // when shown, still prints the value that was actually measured.
  const filledFraction =
    measuredValue !== null && scaleMax !== null
      ? Math.min(1, Math.max(0, measuredValue / scaleMax))
      : 0
  const dashOffset = semicircleLength * (1 - filledFraction)
  const hasVisibleArc = filledFraction > 0

  const arcPath = `M ${centreX - radius} ${baselineY} A ${radius} ${radius} 0 0 1 ${centreX + radius} ${baselineY}`

  // ── Optional caption ───────────────────────────────────────────────────────
  const arcBottom = baselineY + strokeWidth / 2 + 1
  const captionSize = hasMeasurement
    ? Math.max(8, Math.round(width * 0.14))
    : Math.max(7, Math.floor((width - 4) / (UNAVAILABLE.length * GLYPH_WIDTH_RATIO)))
  const viewHeight = showValueCaption ? arcBottom + captionSize + 2 : arcBottom
  const captionText =
    measuredValue !== null && scaleMax !== null
      ? `${formatFigure(measuredValue)}/${formatFigure(scaleMax)}`
      : UNAVAILABLE

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={viewHeight}
      viewBox={`0 0 ${width} ${viewHeight}`}
      className="shrink-0"
    >
      {/* Track. Dashed = nothing was ever measured; solid = there is a value,
          even when that value is 0 and therefore draws no arc at all. */}
      <path
        d={arcPath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={hasMeasurement ? undefined : `${strokeWidth * 0.35} ${strokeWidth * 0.8}`}
        strokeLinecap={hasMeasurement ? 'butt' : 'round'}
        className="stroke-[var(--chart-track)]"
      />

      {hasVisibleArc ? (
        <>
          {/* The halo is a second, wider, translucent stroke rather than a blur
              filter: at this size a Gaussian blur turns the arc to mush. */}
          <path
            d={arcPath}
            fill="none"
            strokeWidth={strokeWidth * 1.9}
            strokeLinecap="round"
            strokeDasharray={semicircleLength}
            strokeDashoffset={dashOffset}
            strokeOpacity={0.55}
            className="stroke-[var(--accent-glow)]"
          />
          <path
            d={arcPath}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeDasharray={semicircleLength}
            strokeDashoffset={dashOffset}
            className="stroke-[var(--chart-line)]"
          />
        </>
      ) : null}

      {showValueCaption ? (
        <text
          x={centreX}
          y={arcBottom + captionSize / 2 + 1}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={captionSize}
          className={hasMeasurement ? 'fill-zinc-400 font-mono tabular-nums' : 'fill-zinc-500'}
        >
          {captionText}
        </text>
      ) : null}
    </svg>
  )
}
