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
 * only (grid, rails, areas, curves, kept at true stroke width by
 * `non-scaling-stroke`) while the axis ticks, the x labels, the observed period
 * and the legend are ordinary HTML positioned against the same numbers. Crisp
 * type at every width, one source of geometry.
 *
 * THREE STATES, AND THEY MUST NOT LOOK ALIKE
 *   · NOTHING WAS MEASURED — that is `Indisponible`, and it is NOT this
 *     component's job. A panel with no measurement renders `<Unavailable />` (or
 *     an `ErrorState` in the danger role) INSTEAD of a chart. Nothing in this
 *     file ever prints that word on the plate, so an empty plate can never be
 *     mistaken for a failed read.
 *   · NOTHING HAPPENED — the window was read and it is genuinely empty (no
 *     series, no interval, or every point measured at 0). That is a real result
 *     and it gets a real plate: the grid, both rails, the baseline labelled `0`,
 *     the observed period (or the explicit statement that no interval was
 *     observed), the legend when the series identities are known, and the
 *     sentence carried by `emptyMessage`. What it does NOT get is a data mark —
 *     no curve, no dot, no area, and no fabricated axis top.
 *   · POPULATED — same frame, plus the full tick scale, the x labels and the
 *     curves.
 * The frame is therefore drawn in every state; only the marks and the tick
 * VALUES depend on what was measured. An empty panel that draws no structure at
 * all is a defect of its own: it reads as a broken render rather than a quiet
 * window.
 *
 * Non-finite points are dropped from the geometry AND break the curve, so an
 * unmeasured interval shows as a gap instead of a smooth line straight through
 * it — that is what the sr-only table already says for the same cell. Negative
 * values are clamped to the baseline for drawing only; the table always reports
 * the raw values.
 *
 * CONTRAST, measured against the real `--color-surface-sunken` bed (#0b0b0d)
 * through Tailwind's actual OKLCH zinc steps, not guessed: `--chart-grid`
 * (1.10:1) and `text-content-faint` (2.54:1) are both a structure nobody can see.
 * The rail — the actual measured 0 baseline and the plate's edge — is drawn
 * `zinc-500` (4.07:1, clears the 3:1 non-text floor with margin). The grid is
 * `zinc-600` (2.54:1): still short of that floor on its own, but it is pure
 * redundant structure — every gridline's value is restated in the `zinc-400`
 * tick label beside it (7.48:1) and in the sr-only table — and it stays one
 * step dimmer than the rail on purpose, so the hierarchy reads rail > grid.
 * Every label clears AA. The token is left untouched on purpose: `src/theme.css`
 * is not this component's to edit.
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
/**
 * How many gaps the tick scale aims for. The actual count follows the data —
 * a window whose busiest interval held 1 run gets 1 gap, not four quarter-run
 * gridlines.
 */
const TARGET_INTERVALS = 4
/**
 * The empty plate's grid. Fractions of the plate HEIGHT, not of a value: no
 * scale is asserted, only the structure is drawn. The baseline (0) is the rail
 * and is drawn separately.
 */
const EMPTY_GRID_FRACTIONS = [1, 0.75, 0.5, 0.25] as const
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
  muted: 'stroke-content-subtle',
  danger: 'stroke-[var(--state-danger-text)]',
}

const SERIES_DOT: Record<TrendSeriesTone, string> = {
  accent: 'bg-[var(--chart-line)]',
  muted: 'bg-content-subtle',
  danger: 'bg-[var(--state-danger-text)]',
}

/**
 * Written out rather than derived from `SERIES_STROKE` by string surgery:
 * Tailwind generates a utility only if it can SEE the literal in the source, so
 * a class assembled at runtime compiles to nothing and the mark renders unpainted.
 */
const SERIES_FILL: Record<TrendSeriesTone, string> = {
  accent: 'fill-[var(--chart-line)]',
  muted: 'fill-content-subtle',
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
 * The tick VALUES, top down to 0.
 *
 * Ticks taken straight off the raw max read as noise (`13.7 / 10.3 / 6.9 / 3.4
 * / 0`), so the STEP is what gets rounded and the top is a whole number of
 * steps — every tick is then as round as the step, and the top is always ≥
 * `rawMax` so no measured point falls off the plate.
 *
 * THE COUNT OF TICKS FOLLOWS THE DATA. A fixed five-line scale forced a top of
 * four steps whatever the data was, which over integer counts printed
 * `1 / 0.75 / 0.5 / 0.25 / 0` — and 0.75 of a run is not a quantity this
 * console can measure. When every sample is a whole number the step is rounded
 * up to one, and the plate simply draws fewer gridlines.
 */
function buildTicks(rawMax: number, integerScale: boolean): number[] {
  const rawStep = rawMax > 0 ? rawMax / TARGET_INTERVALS : 0
  const step = integerScale ? Math.max(1, Math.ceil(niceCeiling(rawStep))) : niceCeiling(rawStep)
  const intervals = rawMax > 0 ? Math.max(1, Math.ceil(rawMax / step)) : 1
  // Rounded to the STEP's own magnitude, never to a fixed two decimals. A cost
  // series peaking at $0.0024 has a step of 0.001, and `round2` collapsed every
  // tick — including the top — to 0; `yFor` then divided by that 0 and fed
  // `cy="NaN"` to a <circle>. The scale must keep as many decimals as the step
  // it is built from.
  const decimals = clamp(Math.ceil(-Math.log10(step)) + 1, 0, 20)
  const ticks: number[] = []
  for (let index = intervals; index >= 0; index -= 1) ticks.push(Number((step * index).toFixed(decimals)))
  return ticks
}

function formatAxisValue(value: number) {
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  if (Number.isInteger(value)) return String(value)
  // Two decimals is not enough for a cost axis: a scale running 0.001 → 0.003
  // printed "0 / 0 / 0 / 0", which reads as an empty measurement rather than a
  // sub-cent one. Keep enough decimals for the value to survive rounding.
  const decimals = clamp(Math.ceil(-Math.log10(Math.abs(value))) + 1, 2, 20)
  return String(Number(value.toFixed(decimals)))
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

type Sample = { index: number; value: number }
type PlotPoint = { x: number; y: number }

/**
 * Contiguous runs of measured intervals. A hole (a non-finite sample, or a
 * series shorter than `xLabels`) ENDS the run instead of being interpolated
 * across: the curve used to be drawn straight through a gap while the sr-only
 * table said `Indisponible` for the same interval — two layers of one component
 * disagreeing about whether a measurement exists.
 */
function toSegments(samples: Sample[]): Sample[][] {
  const segments: Sample[][] = []
  let current: Sample[] = []
  for (const sample of samples) {
    const previous = current[current.length - 1]
    if (previous !== undefined && sample.index !== previous.index + 1) {
      segments.push(current)
      current = []
    }
    current.push(sample)
  }
  if (current.length > 0) segments.push(current)
  return segments
}

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

/**
 * The observed period, read off the interval labels themselves — the only place
 * the chart holds it. `null` when no interval was observed at all, which is a
 * fact about the window and is stated as such rather than guessed.
 */
function observedPeriod(xLabels: string[]): string | null {
  if (xLabels.length === 0) return null
  const first = xLabels[0]
  const last = xLabels[xLabels.length - 1]
  return first === last ? first : `${first} → ${last}`
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
  // Counts, not measures: when every sample the window produced is a whole
  // number the axis stays whole too. Decided from the data, never from a flag
  // the caller could forget.
  const integerScale = plotted.every((entry) => entry.samples.every((sample) => Number.isInteger(sample.value)))
  const ticks = buildTicks(rawMax, integerScale)
  const niceMax = ticks[0]

  const xFor = (index: number) =>
    columns <= 1 ? VIEW_WIDTH / 2 : (index / (columns - 1)) * VIEW_WIDTH
  const yFor = (value: number) =>
    plotBottom - (clamp(value, 0, niceMax) / niceMax) * (plotBottom - plotTop)

  // The grid. Populated: one line per tick VALUE. Empty: evenly spaced lines
  // that carry no value at all — the plate keeps its structure without claiming
  // a scale nobody measured. The baseline is excluded from both: it is the rail.
  const gridYs = isEmpty
    ? EMPTY_GRID_FRACTIONS.map((fraction) => plotBottom - fraction * (plotBottom - plotTop))
    : ticks.filter((tick) => tick > 0).map((tick) => yFor(tick))

  const shownLabelIndices = visibleLabelIndices(columns)
  const period = observedPeriod(xLabels)
  const firstAccentKey = plotted.find((entry) => entry.tone === 'accent' && entry.samples.length > 1)?.key
  const areaFillId = `trend-area-${stableSuffix(`${series.map((entry) => entry.key).join('|')}:${columns}`)}`

  const periodSentence = period === null ? 'No interval was observed.' : `Observed period ${period}.`
  const ariaLabel = isEmpty
    ? `Chart, ${emptyMessage} ${periodSentence}`
    : `Chart of ${series.map((entry) => entry.label).join(', ')} across ${columns} interval${columns === 1 ? '' : 's'}, ${periodSentence} Maximum ${formatAxisValue(rawMax)}.`

  // The sr-only mirror only exists when there is something to mirror. An empty
  // window used to hand a screen reader a one-column, zero-row table on top of
  // the sentence it had already announced.
  const hasDataTable = series.length > 0 && columns > 0

  return (
    <figure className="min-w-0">
      {/* The legend is series IDENTITY, not series data: it survives a window
          that measured nothing, because "which curves would be here" is known
          even when none of them has a point to draw. */}
      {series.length > 0 ? (
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((entry) => (
            <span key={entry.key} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${SERIES_DOT[entry.tone]}`} />
              <span className="text-[10px]/4 uppercase tracking-widest text-content-muted">{entry.label}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="flex min-w-0 gap-2">
        {/* Y ticks — HTML, positioned at the exact px the gridlines use. On an
            empty plate only the BASELINE is labelled: a window that was read and
            held nothing has a floor of 0, which is measured, while any tick
            above it would be an axis top nobody measured. */}
        <div className="relative w-10 shrink-0" style={{ height: plotHeight }}>
          {isEmpty ? (
            <span
              className="absolute right-1.5 -translate-y-1/2 text-[10px]/3 tabular-nums text-content-muted"
              style={{ top: plotBottom }}
            >
              0
            </span>
          ) : (
            ticks.map((tick) => (
              <span
                key={tick}
                className="absolute right-1.5 -translate-y-1/2 text-[10px]/3 tabular-nums text-content-muted"
                style={{ top: yFor(tick) }}
              >
                {formatAxisValue(tick)}
              </span>
            ))
          )}
        </div>

        <div className="relative min-w-0 flex-1">
          <svg
            role="img"
            aria-label={ariaLabel}
            width="100%"
            height={plotHeight}
            viewBox={`0 0 ${VIEW_WIDTH} ${plotHeight}`}
            preserveAspectRatio="none"
            className="block rounded-lg bg-surface-sunken shadow-[var(--shadow-well)]"
          >
            {showArea && firstAccentKey && !isEmpty ? (
              <defs>
                {/* Three stops, not two. A straight dense→transparent ramp keeps
                    too much ink near the baseline and the fill reads as a solid
                    block; pulling most of the fade into the top third makes the
                    area hug the curve and dissolve into the plate. */}
                <linearGradient id={areaFillId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-fill)" />
                  <stop offset="45%" stopColor="var(--chart-fill)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--chart-fill-fade)" />
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
                className="stroke-content-faint"
              />
            ))}

            {/* The two rails. Drawn one step above the grid so the plate reads as
                a plate in every state — including the state where nothing else
                is drawn on it. The left rail is stroked at 2 and clipped by the
                viewport to a crisp 1px flush with the edge. */}
            <line
              x1={0}
              x2={VIEW_WIDTH}
              y1={plotBottom}
              y2={plotBottom}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              className="stroke-content-subtle"
            />
            <line
              x1={0}
              x2={0}
              y1={0}
              y2={plotHeight}
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              shapeRendering="crispEdges"
              className="stroke-content-subtle"
            />

            {isEmpty
              ? null
              : plotted.flatMap((entry) =>
                  toSegments(entry.samples).map((segment) => {
                    const points = segment.map((sample) => ({
                      x: xFor(sample.index),
                      y: yFor(sample.value),
                    }))
                    const segmentKey = `${entry.key}-${segment[0].index}`

                    if (points.length === 1) {
                      const only = points[0]
                      return (
                        <circle
                          key={segmentKey}
                          cx={only.x}
                          cy={only.y}
                          r={3}
                          vectorEffect="non-scaling-stroke"
                          className={SERIES_FILL[entry.tone]}
                        />
                      )
                    }

                    const line = smoothPath(points, plotTop, plotBottom)
                    const fillsArea = showArea && entry.key === firstAccentKey
                    const areaPath = fillsArea
                      ? `${line} L ${round2(points[points.length - 1].x)} ${plotHeight} L ${round2(points[0].x)} ${plotHeight} Z`
                      : null

                    return (
                      <g key={segmentKey}>
                        <title>{entry.label}</title>
                        {areaPath ? <path d={areaPath} fill={`url(#${areaFillId})`} stroke="none" /> : null}
                        {/* NO GLOW. The curve is a clean 2px stroke over its area
                            fill — no halo, no bloom, no stacked translucent copies.
                            Depth on this plate comes from the recessed bed the chart
                            sits in (`--shadow-well`), not from making the line emit. */}
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
                  })
                )}
          </svg>

          {/* `aria-hidden` because the `<svg>` above already carries this exact
              sentence as its accessible name: shown once, announced once. */}
          {isEmpty ? (
            <p
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center text-[11px]/4 text-content-muted"
            >
              {/* A middle gridline sits at this exact vertical centre, so the
                  bare sentence used to read with a horizontal rule drawn right
                  through its glyphs. `bg-surface-sunken` matches the SVG plate
                  underneath — same plane, not a new one — so the pill reads as
                  the line stopping at its edges rather than a patch of mismatched
                  colour. */}
              <span className="rounded-full bg-surface-sunken px-3 py-1">{emptyMessage}</span>
            </p>
          ) : null}
        </div>
      </div>

      {/* The x axis. Intervals when there are intervals; otherwise the plain
          statement that none was observed — never a blank strip, and never an
          invented range. */}
      <div className="mt-1.5 flex min-w-0 gap-2">
        <div className="w-10 shrink-0" />
        <div className="relative h-4 min-w-0 flex-1">
          {columns > 0 ? (
            shownLabelIndices.map((index) => {
              const isFirst = index === 0
              const isLast = index === columns - 1
              return (
                <span
                  key={`${xLabels[index]}-${index}`}
                  className="absolute top-0 whitespace-nowrap text-[10px]/4 tabular-nums text-content-muted"
                  style={{
                    left: `${(xFor(index) / VIEW_WIDTH) * 100}%`,
                    transform: isFirst ? 'none' : isLast ? 'translateX(-100%)' : 'translateX(-50%)',
                  }}
                >
                  {xLabels[index]}
                </span>
              )
            })
          ) : (
            <span aria-hidden="true" className="absolute top-0 left-0 text-[10px]/4 text-content-muted">
              No interval observed
            </span>
          )}
        </div>
      </div>

      {/* The same numbers, reachable without sight. A raw table on purpose: it is
          never seen, so the Catalyst table's density chrome would be dead weight. */}
      {hasDataTable ? (
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
      ) : null}
    </figure>
  )
}
