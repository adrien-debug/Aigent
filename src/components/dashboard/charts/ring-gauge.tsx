/**
 * RingGauge — the big ring of the "Actions prioritaires" card.
 *
 * Server-rendered SVG on purpose: two concentric circles and one dash offset do
 * not justify a charting runtime, and a chart that renders on the server has no
 * hydration gap where a wrong number can flash. No state, no measurement, no
 * data access — it receives a number (or the absence of one) and draws it.
 *
 * THE ONE RULE IT ENCODES: an unmeasured value is NOT a zero. `value === null`
 * draws the track alone — no arc at all, not even an empty one — and writes
 * UNAVAILABLE_LABEL in the centre. A 0% arc and an unmeasured ring must never
 * look alike, because they mean opposite things to whoever reads the card. The
 * absent-measurement word is IMPORTED, never spelled here: one spelling, one
 * place (`labels.ts`), or "Indisponible" / "—" / "0" start drifting apart.
 */
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/labels'

/** ~13px of stroke at the reference diameter of 150, scaled from there. */
const STROKE_AT_REFERENCE_SIZE = 13 / 150
const MIN_STROKE = 4

/** Keeps the emitted attributes readable — 430.3981935418017 helps nobody. */
const round2 = (n: number) => Math.round(n * 100) / 100

type RingGaugeProps = {
  /**
   * A WHOLE value on the 0..max scale — `success24h` is ALREADY 0..100, never a
   * 0..1 ratio, so it is never multiplied here. `null` = nothing was measured.
   */
  value: number | null
  /** The scale `value` is expressed against. 100 (i.e. a percentage) by default. */
  max?: number
  /** What the ring measures, in French. Read by screen readers; never drawn. */
  label: string
  /** Tiny line under the big figure, in French. */
  caption?: string
  /** Outer diameter, in px. */
  size?: number
}

export function RingGauge({ value, max = 100, label, caption, size = 150 }: RingGaugeProps) {
  // Geometry. The stroke is centred on the radius, so the circle must be inset
  // by half a stroke on each side to keep the ring inside the box.
  const stroke = Math.max(MIN_STROKE, Math.round(size * STROKE_AT_REFERENCE_SIZE))
  const center = size / 2
  const radius = Math.max(0, (size - stroke) / 2)
  const circumference = round2(2 * Math.PI * radius)

  // A measurement exists only when the value AND its scale are both usable.
  // Anything else falls to the unmeasured branch — never to a confident 0.
  const measured =
    value !== null && Number.isFinite(value) && Number.isFinite(max) && max > 0 ? value : null

  // Clamped: a value outside 0..max would otherwise yield a negative dash offset
  // (an arc longer than the circle) or an inverted one.
  const filledFraction = measured === null ? 0 : Math.min(Math.max(measured / max, 0), 1)
  const dashOffset = round2(circumference * (1 - filledFraction))

  const figure = measured === null ? null : `${Math.round(measured)}${max === 100 ? '%' : ''}`
  // French reading of the ring: the label is supplied by the caller, the state
  // of the measurement is this component's own word.
  const ariaLabel = figure === null ? `${label} : ${UNAVAILABLE_LABEL}` : `${label} : ${figure}`

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="relative shrink-0"
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
        focusable="false"
        className="block"
      >
        {/* Track — always drawn, so the ring reads as a ring even with nothing measured. */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="var(--chart-track)"
          strokeWidth={stroke}
        />
        {/* Arc — omitted entirely when unmeasured. Rotated so it starts at 12 o'clock. */}
        {measured === null ? null : (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="var(--chart-bar)"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            transform={`rotate(-90 ${center} ${center})`}
          />
        )}
      </svg>

      {/* The centre is aria-hidden: the wrapper's `aria-label` already says it,
          and a screen reader must not read the figure twice. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-4 text-center"
      >
        {figure === null ? (
          // Zinc, small enough to sit inside the ring at every size this card
          // uses — and never the accent: an absent measurement is not a result.
          <span className="text-xs font-medium text-zinc-400">{UNAVAILABLE_LABEL}</span>
        ) : (
          <>
            <span className="font-mono text-3xl leading-none font-semibold text-white tabular-nums">
              {figure}
            </span>
            {caption ? <span className="text-xs text-zinc-400">{caption}</span> : null}
          </>
        )}
      </div>
    </div>
  )
}
