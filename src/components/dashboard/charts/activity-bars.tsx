/**
 * ActivityBars — the stacked run-activity plate of the fleet-activity card.
 *
 * Server-rendered SVG, no dependency, no DOM measurement: the plate is fluid
 * because the `viewBox` scales uniformly to the container width, not because
 * anything measures it at runtime. `height` therefore sets the PROPORTION of the
 * plate (≈170 tall against a ≈440 wide column) and the rendered height follows
 * the column. `preserveAspectRatio="none"` was rejected — it would stretch every
 * tick label horizontally.
 *
 * Each bucket stacks two-tone: the successful part on the baseline in the accent,
 * the remainder above it in muted grey. Both are measured counts, so
 * `total - successful` is a subtraction of two facts, not an inferred value.
 * `successful` IS `status === 'completed'` upstream, hence the canonical run
 * label in the screen-reader series — no second spelling invented here.
 *
 * EMPTY ≠ UNAVAILABLE. A window that was read and held no run is a measured
 * fact, and it says so in its own words. It must NOT borrow UNAVAILABLE_LABEL,
 * which means the read itself failed. The two states are different truths and
 * keep different sentences.
 */
import { AGENT_RUN_STATUS_LABELS } from '@/lib/agent-mission-control/labels'

const VIEW_WIDTH = 440
const PAD = { top: 8, right: 26, bottom: 20, left: 26 }
/** Gridline intervals — 4 gaps, so 5 lines including the baseline. */
const TICK_DIVISIONS = 4
const MAX_X_LABELS = 6
/** Share of each bucket slot the bar occupies; the rest is the gap. */
const BAR_FILL_RATIO = 0.62
/**
 * A hard cap on top of the ratio. The full window is 12 buckets (bar ≈20 wide,
 * under the cap and untouched), but the collector also returns a SINGLE bucket
 * when every run shares one instant — at which point the ratio alone would draw
 * one 240-wide slab across the plate instead of a bar.
 */
const MAX_BAR_WIDTH = 24
const CORNER_RADIUS = 2
const TICK_FONT_SIZE = 8

/** The window was read and held nothing — a fact, not a failed measurement. */
const NO_RUN_MESSAGE = 'Aucun run enregistré sur cette fenêtre'

/** Keeps the emitted path data readable — 31.299999999999997 helps nobody. */
const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * The chart's only prose is read aloud, so "1 intervalles" is not acceptable.
 * French rule, not the English one: 0 and 1 both stay singular ("0 run").
 */
const plural = (count: number, noun: string) => `${count} ${noun}${count >= 2 ? 's' : ''}`

/** A count that reached us as garbage is not drawn as a confident zero. */
const safeCount = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0)

type ActivityBucket = { label: string; total: number; successful: number }

type ActivityBarsProps = {
  buckets: ActivityBucket[]
  /** viewBox height — the proportion of the plate, not a pixel height. */
  height?: number
}

/**
 * Rungs the tick step snaps to. Finer than the usual 1/2/5 on purpose: with only
 * four divisions, 1/2/5 sends a peak of 9 to an axis of 20 and leaves the tallest
 * bar filling 45% of the plate. Probed over every peak from 1 to 5000, these
 * rungs keep the tallest bar at ≥50% and every tick an integer.
 */
const TICK_LADDER = [1, 2, 3, 4, 5, 6, 8, 10]

/**
 * The tick step is chosen first and the axis maximum derived from it, so every
 * tick is an exact multiple of the step. Floored at 1: half a run is not a tick.
 */
function niceTickStep(peak: number, divisions: number) {
  const rough = peak / divisions
  const magnitude = Math.max(1, 10 ** Math.floor(Math.log10(rough)))
  for (const rung of TICK_LADDER) {
    if (rough <= rung * magnitude) return rung * magnitude
  }
  return 10 * magnitude
}

/** A bar with only its TOP corners rounded — `rx` on a `<rect>` rounds all four. */
function topRoundedBarPath(x: number, y: number, width: number, barHeight: number) {
  const r = Math.min(CORNER_RADIUS, width / 2, barHeight)
  const [left, right, top, bottom] = [x, x + width, y, y + barHeight].map(round2)
  return [
    `M ${left} ${bottom}`,
    `L ${left} ${round2(top + r)}`,
    `Q ${left} ${top} ${round2(left + r)} ${top}`,
    `L ${round2(right - r)} ${top}`,
    `Q ${right} ${top} ${right} ${round2(top + r)}`,
    `L ${right} ${bottom}`,
    'Z',
  ].join(' ')
}

export function ActivityBars({ buckets, height = 170 }: ActivityBarsProps) {
  const plotWidth = VIEW_WIDTH - PAD.left - PAD.right
  const plotHeight = height - PAD.top - PAD.bottom
  const baselineY = PAD.top + plotHeight

  const peakTotal = buckets.reduce((peak, bucket) => Math.max(peak, safeCount(bucket.total)), 0)
  // A window with zero runs IS a measurement — but it has no meaningful scale,
  // so the plate keeps its gridlines and drops the (fabricated) tick numbers.
  // `<= 0` and not `=== 0`: a negative peak would send `niceTickStep` through
  // `Math.log10` of a negative and paint the plate with NaN geometry.
  const isEmpty = buckets.length === 0 || peakTotal <= 0
  const tickStep = isEmpty ? 0 : niceTickStep(peakTotal, TICK_DIVISIONS)
  const axisMax = tickStep * TICK_DIVISIONS

  // Gridlines are placed by fraction, so they survive the empty state; `valueY`
  // needs a scale and is only ever called from the measured branches below.
  const gridlineY = (index: number) => round2(PAD.top + plotHeight * (1 - index / TICK_DIVISIONS))
  const valueY = (value: number) => baselineY - plotHeight * (value / axisMax)

  const slotWidth = buckets.length > 0 ? plotWidth / buckets.length : 0
  const barWidth = round2(Math.min(slotWidth * BAR_FILL_RATIO, MAX_BAR_WIDTH))
  const labelEvery = Math.max(1, Math.ceil(buckets.length / MAX_X_LABELS))

  const ariaLabel = isEmpty
    ? `Activité des runs par intervalle : ${NO_RUN_MESSAGE.toLowerCase()}`
    : `Activité des runs par intervalle : ${plural(buckets.length, 'intervalle')}, ` +
      `pic de ${plural(peakTotal, 'run')} sur un intervalle`

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${VIEW_WIDTH} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        width="100%"
        role="img"
        aria-label={ariaLabel}
        className="block h-auto w-full"
      >
        {Array.from({ length: TICK_DIVISIONS + 1 }, (_, index) => (
          <line
            key={`grid-${index}`}
            x1={PAD.left}
            x2={VIEW_WIDTH - PAD.right}
            y1={gridlineY(index)}
            y2={gridlineY(index)}
            stroke="var(--chart-grid)"
            strokeWidth={1}
          />
        ))}

        {/* Y ticks on BOTH edges, from the rounded axis max — never the raw peak,
            so every label is a round integer. Dropped when nothing was counted:
            a scale of 0..4 over an empty window is an invented axis. */}
        {isEmpty
          ? null
          : Array.from({ length: TICK_DIVISIONS + 1 }, (_, index) => {
              const tickValue = String(index * tickStep)
              const tickY = round2(gridlineY(index) + TICK_FONT_SIZE / 3)
              return (
                <g key={`tick-${index}`} className="fill-zinc-400 font-mono tabular-nums">
                  <text x={PAD.left - 5} y={tickY} textAnchor="end" fontSize={TICK_FONT_SIZE}>
                    {tickValue}
                  </text>
                  <text
                    x={VIEW_WIDTH - PAD.right + 5}
                    y={tickY}
                    textAnchor="start"
                    fontSize={TICK_FONT_SIZE}
                  >
                    {tickValue}
                  </text>
                </g>
              )
            })}

        {isEmpty
          ? null
          : buckets.map((bucket, index) => {
              const x = round2(PAD.left + slotWidth * index + (slotWidth - barWidth) / 2)
              const total = safeCount(bucket.total)
              const successful = Math.min(safeCount(bucket.successful), total)
              const remainder = total - successful
              // Bottom-up: accent on the baseline, muted remainder above it (its
              // top edge IS the bucket total). Empty segments drop out, so
              // whatever lands last is the top-most — the one that gets corners.
              const segments = [
                { fill: 'var(--chart-bar)', top: successful, span: successful },
                { fill: 'var(--chart-bar-muted)', top: total, span: remainder },
              ].filter((segment) => segment.span > 0)

              return segments.map((segment, order) => {
                const y = round2(valueY(segment.top))
                const barHeight = round2(plotHeight * (segment.span / axisMax))
                const key = `${bucket.label}-${index}-${segment.fill}`
                return order === segments.length - 1 ? (
                  <path
                    key={key}
                    d={topRoundedBarPath(x, y, barWidth, barHeight)}
                    fill={segment.fill}
                  />
                ) : (
                  <rect
                    key={key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barHeight}
                    fill={segment.fill}
                  />
                )
              })
            })}

        {/* X labels stay even on an empty window: the intervals themselves were
            measured. Thinned to every Nth so they never collide at 375px. */}
        {buckets.map((bucket, index) =>
          index % labelEvery === 0 ? (
            <text
              key={`x-${bucket.label}-${index}`}
              x={round2(PAD.left + slotWidth * index + slotWidth / 2)}
              y={height - 6}
              textAnchor="middle"
              fontSize={TICK_FONT_SIZE}
              className="fill-zinc-400 font-mono tabular-nums"
            >
              {bucket.label}
            </text>
          ) : null
        )}

        {isEmpty ? (
          <text
            x={VIEW_WIDTH / 2}
            y={PAD.top + plotHeight / 2}
            textAnchor="middle"
            fontSize={11}
            className="fill-zinc-400"
          >
            {NO_RUN_MESSAGE}
          </text>
        ) : null}
      </svg>

      {/* The series, reachable without sight. The bars above are decorative once
          labelled, so this list is the data — not a summary of it. */}
      {buckets.length > 0 ? (
        <ul className="sr-only">
          {buckets.map((bucket, index) => {
            const total = safeCount(bucket.total)
            const successful = Math.min(safeCount(bucket.successful), total)
            return (
              <li key={`sr-${bucket.label}-${index}`}>
                {`${bucket.label} : ${plural(total, 'run')}, dont ${successful} en statut ` +
                  `« ${AGENT_RUN_STATUS_LABELS.completed} »`}
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
