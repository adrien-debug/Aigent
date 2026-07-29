/**
 * `TrendChart` — the large chart panel of the console, used twice: once
 * single-series (the flagship, with its area fill) and once multi-series.
 *
 * PURE SERVER-RENDERED SVG. No dependency, no `'use client'`, no DOM
 * measurement, no JS-driven animation — a hard constraint of this console.
 *
 * WHY THE TEXT IS HTML AND ONLY THE PLOT IS SVG. Fluid width without letterboxing
 * needs `preserveAspectRatio="none"`, which stretches the viewBox horizontally —
 * and would stretch any `<text>` inside it with it. So the plate holds geometry
 * only (grid, areas, curves, kept at true stroke width by `non-scaling-stroke`)
 * while the axis ticks, the x labels and the legend are ordinary HTML positioned
 * against the same numbers. Crisp type at every width, one source of geometry.
 *
 * TRUTH. Two situations that look alike and must never be worded alike:
 *   · NOTHING WAS MEASURED — that is `Indisponible`, and it is NOT this
 *     component's job. A panel with no measurement renders `<Unavailable />`
 *     instead of a chart.
 *   · NOTHING HAPPENED — the window was read and it is genuinely empty (no
 *     series, no interval, or every point measured at 0). That is a real result,
 *     so the plate is drawn with its grid and says so plainly, in words that do
 *     not claim a failure. `emptyMessage` carries that sentence.
 * Non-finite points are dropped from the geometry rather than plotted; negative
 * values are clamped to the baseline for drawing only — the sr-only table below
 * the chart always reports the raw values.
 *
 * NOT A SPARKLINE. This is a full plate with a grid, an axis and a legend. The
 * banned thing is the decorative mini-curve glued inside a card or a table cell.
 */

import { UNAVAILABLE } from './ring-gauge'

/** Virtual plot width. The viewBox is stretched to the container; y stays in px. */
const VIEW_WIDTH = 1000
/** Breathing room top and bottom so a curve at the extreme never touches the edge. */
const PLOT_INSET = 6
const DEFAULT_PLOT_HEIGHT = 220
/** Five gridlines, top to bottom, as fractions of the nice maximum. */
const TICK_FRACTIONS = [1, 0.75, 0.5, 0.25, 0] as const
/** Above this many intervals, x labels are thinned. */
const MAX_X_LABELS = 8

export type TrendSeriesTone = 'accent' | 'muted' | 'danger'

export type TrendSeries = {
  key: string
  label: string
  tone: TrendSeriesTone
  /** One value per interval, index-aligned with `xLabels`. Never padded here. */
  points: number[]
}

export type TrendChartProps = {
  series: TrendSeries[]
  /** The intervals. Its length defines the number of columns. */
  xLabels: string[]
  /** Plot plate height in px (the legend and labels sit outside it). */
  height?: number
  /** Fill under the FIRST accent series only. Filling every series turns to mud. */
  showArea?: boolean
  /** Sentence for a measured-but-empty window. Never the word "Indisponible". */
  emptyMessage?: string
}

const SERIES_STROKE: Record<TrendSeriesTone, string> = {
  accent: 'stroke-[var(--chart-line)]',
  muted: 'stroke-zinc-500',
  danger: 'stroke-[var(--state-danger-text)]',
}

const SERIES_DOT: Record<TrendSeriesTone, string> = {
  accent: 'bg-[var(--chart-line)]',
  muted: 'bg-zinc-500',
  danger: 'bg-[var(--state-danger-text)]',
}

/**
 * Written out rather than derived from `SERIES_STROKE` by string surgery:
 * Tailwind generates a utility only if it can SEE the literal in the source, so
 * a class assembled at runtime compiles to nothing and the mark renders unpainted.
 */
const SERIES_FILL: Record<TrendSeriesTone, string> = {
  accent: 'fill-[var(--chart-line)]',
  muted: 'fill-zinc-500',
  danger: 'fill-[var(--state-danger-text)]',
}

/* ------------------------------------------------------------------ maths */

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value))
const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Deterministic id suffix. Two charts on one page must not both define
 * `#trend-area-fill`: the second gradient is dropped and the ids are duplicated
 * in the DOM. Server components cannot call `useId`, so the id is derived from
 * the series identity instead — stable between server and client render.
 */
function stableSuffix(seed: string) {
  let hash = 5381
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) + hash + seed.charCodeAt(index)) >>> 0
  }
  return hash.toString(36)
}

/** Round a value UP to 1, 2, 2.5, 5 or 10 × a power of ten. */
function niceCeiling(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const normalised = value / magnitude
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 2.5 ? 2.5 : normalised <= 5 ? 5 : 10
  return step * magnitude
}

/**
 * The axis top. Ticks taken straight off the raw max read as noise
 * (`13.7 / 10.3 / 6.9 / 3.4 / 0`), but rounding the TOP alone is not enough
 * either: a top of 10 across four intervals still prints `7.5 / 2.5`. So the
 * STEP is what gets rounded, and the top is four of them — every tick is then as
 * round as the step. Always ≥ `rawMax`, so no measured point falls off the plate.
 */
function niceAxisTop(rawMax: number) {
  const intervals = TICK_FRACTIONS.length - 1
  return niceCeiling(rawMax / intervals) * intervals
}

function formatAxisValue(value: number) {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  if (Number.isInteger(value)) return String(value)
  return String(Math.round(value * 100) / 100)
}

/**
 * The sr-only mirror of a plotted point. A ragged series (fewer points than
 * `xLabels`) has NO measurement for that interval, and the word for that is the
 * same one the visible layer prints — an em-dash would tell a screen-reader user
 * something different from what the gauges say to everyone else.
 */
function formatCellValue(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return UNAVAILABLE
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100)
}

type PlotPoint = { x: number; y: number }

/**
 * Catmull-Rom → cubic Bézier. Each segment borrows its neighbours to pick control
 * points, which is what turns an index series into the smooth curve of the
 * reference instead of a jagged polyline. Control points are clamped inside the
 * plate so the spline's natural overshoot cannot bleed past the grid.
 */
function smoothPath(points: PlotPoint[], plotTop: number, plotBottom: number) {
  if (points.length === 0) return ''
  const first = points[0]
  if (points.length === 1) return `M ${round2(first.x)} ${round2(first.y)}`

  let path = `M ${round2(first.x)} ${round2(first.y)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const previous = points[Math.max(0, i - 1)]
    const current = points[i]
    const next = points[i + 1]
    const following = points[Math.min(points.length - 1, i + 2)]

    const control1X = current.x + (next.x - previous.x) / 6
    const control1Y = clamp(current.y + (next.y - previous.y) / 6, plotTop, plotBottom)
    const control2X = next.x - (following.x - current.x) / 6
    const control2Y = clamp(next.y - (following.y - current.y) / 6, plotTop, plotBottom)

    path += ` C ${round2(control1X)} ${round2(control1Y)}, ${round2(control2X)} ${round2(control2Y)}, ${round2(next.x)} ${round2(next.y)}`
  }
  return path
}

/** Evenly thinned x labels, always including the last interval when it is not crowded. */
function visibleLabelIndices(columns: number) {
  if (columns <= 0) return []
  const stride = Math.max(1, Math.ceil(columns / MAX_X_LABELS))
  const indices: number[] = []
  for (let i = 0; i < columns; i += stride) indices.push(i)
  const last = columns - 1
  const previous = indices[indices.length - 1]
  if (previous !== last && last - previous >= Math.max(1, Math.floor(stride / 2))) indices.push(last)
  return indices
}

/* ------------------------------------------------------------- component */

export function TrendChart({
  series,
  xLabels,
  height = DEFAULT_PLOT_HEIGHT,
  showArea = false,
  emptyMessage = 'No run was recorded in this window.',
}: TrendChartProps) {
  const plotHeight = Math.max(120, Math.round(Number.isFinite(height) ? height : DEFAULT_PLOT_HEIGHT))
  const plotTop = PLOT_INSET
  const plotBottom = plotHeight - PLOT_INSET
  const columns = xLabels.length

  // Only finite samples reach the geometry. A series shorter than `xLabels` simply
  // stops — it is never padded with zeros, which would be invented data.
  const plotted = series.map((entry) => ({
    ...entry,
    samples: entry.points
      .slice(0, columns)
      .map((value, index) => ({ index, value }))
      .filter((sample) => Number.isFinite(sample.value)),
  }))

  const finiteCount = plotted.reduce((total, entry) => total + entry.samples.length, 0)
  const nonZeroCount = plotted.reduce(
    (total, entry) => total + entry.samples.filter((sample) => sample.value !== 0).length,
    0
  )
  const isEmpty = series.length === 0 || columns === 0 || finiteCount === 0 || nonZeroCount === 0

  const rawMax = plotted.reduce(
    (best, entry) => entry.samples.reduce((inner, sample) => Math.max(inner, sample.value), best),
    0
  )
  const niceMax = niceAxisTop(rawMax)

  const xFor = (index: number) =>
    columns <= 1 ? VIEW_WIDTH / 2 : (index / (columns - 1)) * VIEW_WIDTH
  const yFor = (value: number) =>
    plotBottom - (clamp(value, 0, niceMax) / niceMax) * (plotBottom - plotTop)

  const gridYs = TICK_FRACTIONS.map((fraction) => plotBottom - fraction * (plotBottom - plotTop))
  const shownLabelIndices = visibleLabelIndices(columns)
  const firstAccentKey = plotted.find((entry) => entry.tone === 'accent' && entry.samples.length > 1)?.key
  const areaFillId = `trend-area-${stableSuffix(`${series.map((entry) => entry.key).join('|')}:${columns}`)}`

  const ariaLabel = isEmpty
    ? `Chart, ${emptyMessage}`
    : `Chart of ${series.map((entry) => entry.label).join(', ')} across ${columns} interval${columns === 1 ? '' : 's'}, maximum ${formatAxisValue(rawMax)}.`

  return (
    <figure className="min-w-0">
      {series.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${SERIES_DOT[entry.tone]}`} />
              <span className="text-[10px]/4 uppercase tracking-widest text-zinc-500">{entry.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 gap-2">
        {/* Y ticks — HTML, positioned at the exact px the gridlines use. Suppressed
            when the window is empty: printing a 0..1 scale over no data would be
            a fabricated axis. */}
        <div className="relative w-10 shrink-0" style={{ height: plotHeight }}>
          {isEmpty
            ? null
            : TICK_FRACTIONS.map((fraction, index) => (
                <span
                  key={fraction}
                  className="absolute right-1.5 -translate-y-1/2 text-[10px]/3 tabular-nums text-zinc-600"
                  style={{ top: gridYs[index] }}
                >
                  {formatAxisValue(fraction * niceMax)}
                </span>
              ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <svg
            role="img"
            aria-label={ariaLabel}
            width="100%"
            height={plotHeight}
            viewBox={`0 0 ${VIEW_WIDTH} ${plotHeight}`}
            preserveAspectRatio="none"
            className="block rounded-lg bg-surface-sunken"
          >
            {showArea && firstAccentKey ? (
              <defs>
                <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-fill)" />
                  <stop offset="100%" stopColor="transparent" />
                </linearGradient>
              </defs>
            ) : null}

            {gridYs.map((y) => (
              <line
                key={y}
                x1={0}
                x2={VIEW_WIDTH}
                y1={y}
                y2={y}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                shapeRendering="crispEdges"
                className="stroke-[var(--chart-grid)]"
              />
            ))}

            {isEmpty
              ? null
              : plotted.map((entry) => {
                  const points = entry.samples.map((sample) => ({
                    x: xFor(sample.index),
                    y: yFor(sample.value),
                  }))
                  if (points.length === 0) return null
                  const line = smoothPath(points, plotTop, plotBottom)

                  if (points.length === 1) {
                    const only = points[0]
                    return (
                      <circle
                        key={entry.key}
                        cx={only.x}
                        cy={only.y}
                        r={3}
                        vectorEffect="non-scaling-stroke"
                        className={SERIES_FILL[entry.tone]}
                      />
                    )
                  }

                  const fillsArea = showArea && entry.key === firstAccentKey
                  const areaPath = fillsArea
                    ? `${line} L ${round2(points[points.length - 1].x)} ${plotHeight} L ${round2(points[0].x)} ${plotHeight} Z`
                    : null

                  return (
                    <g key={entry.key}>
                      <title>{entry.label}</title>
                      {areaPath ? <path d={areaPath} fill={`url(#${areaFillId})`} stroke="none" /> : null}
                      {entry.tone === 'accent' ? (
                        // The luminous stroke of the reference: a wide translucent
                        // copy under the curve. Not a blur filter — a filter region
                        // is stretched by `preserveAspectRatio="none"`.
                        <path
                          d={line}
                          fill="none"
                          strokeWidth={7}
                          strokeOpacity={0.45}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          vectorEffect="non-scaling-stroke"
                          className="stroke-[var(--accent-glow)]"
                        />
                      ) : null}
                      <path
                        d={line}
                        fill="none"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                        className={SERIES_STROKE[entry.tone]}
                      />
                    </g>
                  )
                })}
          </svg>

          {isEmpty ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[11px]/4 text-zinc-500">
              {emptyMessage}
            </p>
          ) : null}
        </div>
      </div>

      {columns > 0 ? (
        <div className="mt-1.5 flex min-w-0 gap-2">
          <div className="w-10 shrink-0" />
          <div className="relative h-4 min-w-0 flex-1">
            {shownLabelIndices.map((index) => {
              const isFirst = index === 0
              const isLast = index === columns - 1
              return (
                <span
                  key={`${xLabels[index]}-${index}`}
                  className="absolute top-0 whitespace-nowrap text-[10px]/4 tabular-nums text-zinc-600"
                  style={{
                    left: `${(xFor(index) / VIEW_WIDTH) * 100}%`,
                    transform: isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {xLabels[index]}
                </span>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* The same numbers, reachable without sight. A raw table on purpose: it is
          never seen, so the Catalyst table's density chrome would be dead weight. */}
      <figcaption className="sr-only">
        <table>
          <caption>{ariaLabel}</caption>
          <thead>
            <tr>
              <th scope="col">Interval</th>
              {series.map((entry) => (
                <th key={entry.key} scope="col">
                  {entry.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {xLabels.map((label, index) => (
              <tr key={`${label}-${index}`}>
                <th scope="row">{label}</th>
                {series.map((entry) => (
                  <td key={entry.key}>{formatCellValue(entry.points[index])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  )
}
