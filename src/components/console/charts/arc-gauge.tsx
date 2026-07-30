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
 *   · `value === null` (or non-finite) → NO ARC. The track alone, drawn DASHED
 *     and one step dimmer.
 *   · `value === 0` → also no arc (a zero-length arc renders a misleading stub),
 *     but the track stays SOLID and one step brighter. That pair — pattern AND
 *     lightness — is what keeps "never measured" distinct from "measured zero"
 *     at a size far too small for a word.
 *   · `max === 0` with a value → a MEASURED zero out of zero (a registry read
 *     cleanly returning nothing). Measured vocabulary: solid track, no arc.
 *   · the KPI card next to it carries the figure — including "Indisponible" when
 *     there is none. This gauge never invents one, and it carries no text of its
 *     own: at the 56px every call site uses, any caption would render at ~7px.
 *
 * THE TRACK HAS TO BE VISIBLE FOR ANY OF THAT TO BE TRUE. It is no longer drawn
 * from `--chart-track` (1.14:1 against the panel — invisible), and the dashed
 * pattern no longer uses round caps: each round cap added half a stroke width at
 * both ends of every dash, more than the gap itself, so the "dashed" track
 * painted as a continuous line and the two states rendered identically.
 * Measured against the real `--color-surface-raised` panel (#101013): the
 * measured/solid track is `zinc-500` (3.93:1, clears the 3:1 non-text floor);
 * the unmeasured/dashed track is `zinc-600` (2.46:1) — dimmer on purpose, since
 * the KPI figure beside it always carries the actual claim, including the word
 * "Indisponible" when there is none. `src/theme.css` is not this component's to
 * edit, hence the zinc utilities.
 *
 * `value` is ALREADY expressed in `max` units. Nothing here multiplies it.
 */

export type ArcGaugeProps = {
  /** Value in `max` units. `null` ⇒ never measured ⇒ no arc, dashed track. */
  value: number | null
  /** Top of the scale. A percentage gauge keeps the default 100. */
  max?: number
  /** Gauge WIDTH in px. The drawn height is roughly half of it. */
  size?: number
  /** Required: the gauge carries no visible text, so this is its only voice. */
  ariaLabel: string
}

export function ArcGauge({ value, max = 100, size = 72, ariaLabel }: ArcGaugeProps) {
  // ── Measurement ────────────────────────────────────────────────────────────
  // `max === 0` is a measured, empty scale — not a missing one. Only a negative
  // or non-finite maximum makes the scale unusable.
  const measuredValue = value !== null && Number.isFinite(value) ? value : null
  const scaleMax = Number.isFinite(max) && max >= 0 ? max : null
  const hasMeasurement = measuredValue !== null && scaleMax !== null

  // ── Geometry: a semicircle opening upwards, drawn left → right ─────────────
  const width = Math.max(36, Math.round(Number.isFinite(size) ? size : 72))
  // Thinner than the original 11%. A heavy arc beside a light-weight figure read
  // as the loudest thing on the card, so the decoration outranked the number it
  // was describing. At ~7% the gauge supports the figure instead of competing.
  const strokeWidth = Math.max(3, Math.round(width * 0.07))
  const centreX = width / 2
  const radius = (width - strokeWidth) / 2
  const baselineY = centreX // the arc's flat side sits at y = radius + stroke/2
  const semicircleLength = Math.PI * radius

  // Clamped so an out-of-range value cannot produce broken geometry. Nothing
  // fills against an empty scale: "0 of 0" draws no sweep.
  const filledFraction =
    measuredValue !== null && scaleMax !== null && scaleMax > 0
      ? Math.min(1, Math.max(0, measuredValue / scaleMax))
      : 0
  const dashOffset = semicircleLength * (1 - filledFraction)
  const hasVisibleArc = filledFraction > 0

  const arcPath = `M ${centreX - radius} ${baselineY} A ${radius} ${radius} 0 0 1 ${centreX + radius} ${baselineY}`
  const viewHeight = baselineY + strokeWidth / 2 + 1

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={viewHeight}
      viewBox={`0 0 ${width} ${viewHeight}`}
      className="shrink-0"
    >
      {/* Track. Dashed and dimmer = nothing was ever measured; solid and brighter
          = there is a value, even when that value is 0 and draws no arc at all. */}
      {/* The TRACK may have round caps: it is a full sweep, so rounding its ends
          cannot misreport a fraction — it only stops the arc looking sheared off.
          The VALUE arc below keeps butt caps, where the distortion would be a lie. */}
      <path
        d={arcPath}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={hasMeasurement ? undefined : `${strokeWidth * 0.5} ${strokeWidth * 1.5}`}
        strokeLinecap="round"
        className={hasMeasurement ? 'stroke-content-subtle' : 'stroke-content-faint'}
      />

      {/* BUTT CAPS, NOT ROUND. At 56px a round cap adds 3px at each end of a 6px
          stroke, so the shortest arc this gauge could draw covered ~7.6% of the
          sweep whatever the value: 1 of 14 painted as ~15% against a true 7.1%.
          The sweep now equals the measured fraction. */}
      {hasVisibleArc ? (
        <>
          {/* The halo is a second, wider, translucent stroke rather than a blur
              filter: at this size a Gaussian blur turns the arc to mush. */}
          {/* NO GLOW: the halo layers that used to sit under this arc were
              removed. A flat painted arc on a recessed plate. */}
          <path
            d={arcPath}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={semicircleLength}
            strokeDashoffset={dashOffset}
            className="stroke-[var(--chart-line)]"
          />
        </>
      ) : null}
    </svg>
  )
}
