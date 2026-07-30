/**
 * `RingGauge` — the large donut ring that dominates the right-hand panels of the
 * console (platform status, delivery readiness).
 *
 * PURE SERVER-RENDERED SVG. No chart library, no `'use client'`, no DOM
 * measurement, no JS-driven animation. It receives numbers and returns markup —
 * that is a hard constraint of this console, not an accident: a chart library
 * here would drag a client boundary across a screen that is otherwise entirely
 * server-rendered. Its ONE import is a string constant from a module that
 * itself imports nothing, which adds no runtime and no boundary.
 *
 * TRUTH — the rule this component exists to enforce visually:
 *   · `value === null`   → NO ARC IS DRAWN. The track alone is rendered, dashed,
 *                          and the centre reads the exact word "Indisponible".
 *                          An unmeasured value must never look like a measured 0.
 *   · `value === 0`      → the figure `0` is drawn, and again no arc (a zero-length
 *                          arc renders a misleading stub). The two cases stay
 *                          distinguishable by the TRACK: solid and one step
 *                          brighter when a measurement exists, dashed and dimmer
 *                          when none does.
 *   · `max === 0` with a value → a MEASURED zero out of zero (an empty registry
 *                          read cleanly). It keeps the measured vocabulary: the
 *                          figure, the caption and a solid track. Painting it as
 *                          "Indisponible" contradicted the caption printed right
 *                          under the ring, which read "0 of 0".
 *   · a non-finite value (NaN / Infinity) is treated as UNMEASURED rather than
 *     plotted — it can only come from a broken computation upstream, and drawing
 *     it would be a claim.
 *
 * THE TRACK IS THE WHOLE DISTINCTION, so it has to be visible. It is no longer
 * drawn from `--chart-track` (measured at 1.14:1 against the panel — a contrast
 * at which neither the track nor its dashes exist on screen) and the dashed
 * pattern no longer uses round caps: at this stroke width each round cap added
 * more length than the gap it had to leave, so the "dashed" track painted as a
 * continuous line and the two states were byte-different but pixel-identical.
 * Measured against the real `--color-surface-raised` panel (#101013) through
 * Tailwind's actual OKLCH zinc steps: the measured/solid track is `zinc-500`
 * (3.93:1, clears the 3:1 non-text floor); the unmeasured/dashed track is
 * `zinc-600` (2.46:1) — a deliberately dimmer secondary state, since the KPI
 * figure or the centre word beside it (`fill-content-muted`, 7.2:1+) already carries
 * the actual claim. `src/theme.css` is not this component's to edit, hence the
 * zinc utilities.
 *
 * `value` is ALREADY expressed in `max` units. A percentage arrives as 0..100 with
 * `max = 100`. Nothing here multiplies it.
 */

import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/**
 * The one word this console renders for an absent measurement, for the SVG
 * layer — an SVG `<text>` cannot host a React element, so the gauges need the
 * raw string rather than `<Unavailable />`.
 *
 * It is NO LONGER spelled here. The word now lives once, in the neutral
 * `format` module, which the HTML layer (`screen-primitives.tsx`), these gauges
 * and `formatUsd` can all import — `formatUsd` is a plain lib function and
 * could not have imported it from a `.tsx` component. This alias is kept so
 * `arc-gauge.tsx` and `trend-chart.tsx` keep their existing import; it is a
 * re-export, not a second literal.
 */
export const UNAVAILABLE = UNAVAILABLE_LABEL

/** Rough advance width of one glyph, as a fraction of the font size. Used only to
 *  size "Indisponible" down until it fits inside the ring — never for layout. */
const GLYPH_WIDTH_RATIO = 0.62

export type RingGaugeProps = {
  /** Value in `max` units. `null` ⇒ never measured ⇒ no arc, "Indisponible". */
  value: number | null
  /** Top of the scale. A percentage gauge keeps the default 100. */
  max?: number
  /** What the ring measures. Read to assistive tech; the panel header shows it visually. */
  label: string
  /** Short unit / qualifier drawn under the figure (e.g. "of 24 agents"). */
  caption?: string
  /** Outer box, in px. The ring is square. */
  size?: number
  /** Arc thickness in px. Defaults to a proportion of `size`. */
  thickness?: number
}

/** Integers stay integers; anything else keeps one decimal. Never rounds to 0 a
 *  value that is not 0 — `0.04` renders `0` only because it rounds there honestly. */
function formatFigure(value: number) {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
}

export function RingGauge({
  value,
  max = 100,
  label,
  caption,
  size = 190,
  thickness,
}: RingGaugeProps) {
  // ── Measurement ────────────────────────────────────────────────────────────
  // `max === 0` is a legitimate MEASURED scale (0 out of 0 agents), not a
  // missing one: only a negative or non-finite maximum makes the scale
  // unusable. The arc cannot fill against an empty scale, so the figure is
  // printed and the track stays solid and empty.
  const measuredValue = value !== null && Number.isFinite(value) ? value : null
  const scaleMax = Number.isFinite(max) && max >= 0 ? max : null
  const hasMeasurement = measuredValue !== null && scaleMax !== null

  // ── Geometry ───────────────────────────────────────────────────────────────
  const box = Math.max(64, Math.round(Number.isFinite(size) ? size : 190))
  const requestedStroke = thickness !== undefined && Number.isFinite(thickness) ? thickness : null
  const strokeWidth = Math.max(4, Math.min(box / 3, Math.round(requestedStroke ?? box * 0.085)))
  const centre = box / 2
  const radius = (box - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius

  // Clamped so an out-of-range value cannot produce broken geometry: the ARC is
  // capped, the printed FIGURE is not — the number stays what was measured.
  // An empty scale (`max === 0`) fills nothing at all: there is no proportion to
  // draw, and inventing a full ring for "0 of 0" would be a claim.
  const filledFraction =
    measuredValue !== null && scaleMax !== null && scaleMax > 0
      ? Math.min(1, Math.max(0, measuredValue / scaleMax))
      : 0
  const dashOffset = circumference * (1 - filledFraction)
  const hasVisibleArc = filledFraction > 0

  // ── Centre typography ──────────────────────────────────────────────────────
  const innerDiameter = box - strokeWidth * 2
  const figureSize = Math.round(box * 0.24)
  const captionSize = Math.max(9, Math.round(box * 0.062))
  const unavailableSize = Math.max(
    9,
    Math.min(
      Math.round(box * 0.1),
      Math.floor((innerDiameter * 0.9) / (UNAVAILABLE.length * GLYPH_WIDTH_RATIO))
    )
  )
  const figureY = caption ? centre - captionSize * 0.7 : centre
  const captionY = centre + figureSize * 0.45

  const ariaLabel =
    measuredValue !== null && scaleMax !== null
      ? `${label}: ${formatFigure(measuredValue)} out of ${formatFigure(scaleMax)}.`
      : `${label}: ${UNAVAILABLE} — no measurement available.`

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      className="shrink-0"
    >
      {/* Track. Solid and one step brighter when something was measured, dashed
          and dimmer when nothing was — that pair is what separates a measured 0
          from "Indisponible" at a glance. Butt caps on both: a round cap adds
          half a stroke width at each end, which at this thickness closes the
          gaps and paints the "dashed" track as a solid one. */}
      <circle
        cx={centre}
        cy={centre}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        strokeDasharray={hasMeasurement ? undefined : `${strokeWidth} ${strokeWidth}`}
        strokeLinecap="butt"
        className={hasMeasurement ? 'stroke-content-subtle' : 'stroke-content-faint'}
      />

      {/* BUTT CAPS, NOT ROUND. A round cap paints half a stroke width beyond each
          end of the arc, so the drawn sweep was always longer than the measured
          fraction — 3 of 14 painted as ~24% against a true 21.4%. The figure in
          the centre and the arc around it now agree. */}
      {hasVisibleArc ? (
        <g transform={`rotate(-90 ${centre} ${centre})`}>
          {/* NO GLOW: a single flat arc. The halo/bloom layers that used to sit
              under this were removed — the ring reads as a painted arc on a
              recessed plate, not as a lit tube. */}
          <circle
            cx={centre}
            cy={centre}
            r={radius}
            fill="none"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="stroke-[var(--chart-line)]"
          />
        </g>
      ) : null}

      {measuredValue !== null && scaleMax !== null ? (
        <>
          <text
            x={centre}
            y={figureY}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={figureSize}
            className="fill-white font-mono tabular-nums"
          >
            {formatFigure(measuredValue)}
          </text>
          {caption ? (
            <text
              x={centre}
              y={captionY}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={captionSize}
              className="fill-content-muted"
            >
              {caption}
            </text>
          ) : null}
        </>
      ) : (
        <text
          x={centre}
          y={centre}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={unavailableSize}
          className="fill-content-muted"
        >
          {UNAVAILABLE}
        </text>
      )}
    </svg>
  )
}
