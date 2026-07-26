'use client'

/**
 * Recharts wrappers for the dashboard charts — Recharts is the standard engine
 * per the Hearst global doctrine (§Graphiques : « Recharts est le moteur
 * standard », « Aucun moteur graphique maison »). These replaced 557 lines of
 * hand-rolled SVG.
 *
 * Why `'use client'`: Recharts measures the DOM to lay out axes, so it cannot
 * render in a Server Component. The charts were previously server-rendered SVG;
 * the boundary is drawn HERE rather than in the pages, so `dashboard-view.tsx`
 * stays a Server Component and only the plot area ships JS.
 *
 * Colours come from the `--chart-*` tokens (src/theme.css) — never a literal
 * hex, so the single-accent rule (`npm run check:ds`) keeps holding.
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from 'recharts'

/** Height of the plot area — matches the previous `h-24` SVG box. */
const PLOT_HEIGHT = 96

/**
 * Focus ring for the plot, applied to the Recharts `<svg>` through the wrapper.
 *
 * MEASURED, before this existed: `recharts-surface` carries `tabIndex={0}` and
 * `role="application"` (Recharts' accessibility layer — arrow keys walk the
 * tooltip, which is the ONLY way to read an hourly value without a pointer), so
 * it is a real tab stop. Its focus ring was the browser default,
 * `outline: auto 5px rgb(0, 95, 204)` — a blue that exists nowhere in a design
 * system whose whole rule is "one accent (#A7FB90) + zinc". Two earlier passes
 * never measured a focus state, so it had never been seen.
 *
 * The ring is declared here rather than on the wrapper because the tab stop IS
 * the svg, not the div; an arbitrary variant is the only way to reach a node
 * Recharts renders itself.
 *
 * KNOWN, NOT FIXED HERE. That tab stop sits inside the wrapper's `role="img"`,
 * whose subtree ARIA declares presentational — so a conforming reader drops the
 * `role="application"` node and its name. The right structure is a single named
 * node (drop the wrapper role, let the svg carry the label — Recharts forwards
 * `aria-label` to the surface, verified in the browser). It is NOT done because
 * Recharts renders no svg at all under jsdom (`ResponsiveContainer` measures a
 * 0px box), so `tests/unit/dashboard-charts.test.tsx` would lose the only seam
 * proving the populated branch renders — and that file is outside this pass's
 * perimeter. The label is passed to BOTH nodes meanwhile, so the tab stop is at
 * least named in the AOM.
 */
const PLOT_BOX =
  '[&_.recharts-surface]:rounded-md [&_.recharts-surface:focus-visible]:outline-2 ' +
  '[&_.recharts-surface:focus-visible]:outline-offset-2 [&_.recharts-surface:focus-visible]:outline-accent-500'

const GRID = 'var(--chart-grid)'
const SUCCESS = 'var(--chart-success)'
const SERIES = 'var(--chart-series)'
const OTHER = 'var(--color-zinc-600)'

const AXIS_TICK = { fill: 'var(--color-zinc-500)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const

/**
 * X-axis tick that cannot be cut in half by the SVG edge.
 *
 * MEASURED on a 390px viewport (the plot area is then 302px wide): Recharts
 * centres every tick label on its band, and the FIRST band centre sits at
 * x≈6.3 while "12:00" is ~25px wide — so the label ran from x≈-6 and the
 * `<svg class="recharts-surface">` clipped it, because an `<svg>` box computes
 * `overflow: hidden` (UA stylesheet). Left edge of the label 37.6px against a
 * left edge of the SVG at 44px on the runs chart, 31.3 against 44 on the cost
 * chart: the hour was unreadable at exactly the width where the axis matters
 * most. Nothing showed at 1024px and above, which is why two earlier passes
 * missed it.
 *
 * It is NOT only a phone defect. On /admin at 1440px the two hourly charts sit
 * in a two-column grid, so each plot is 477px and an hour band is 19.9px wide —
 * narrower than the ~29px label. Centred, the first label ran from x≈-4.8 and
 * lost its first glyph there too; it now spans 9.9→39.4 inside a 477px surface.
 *
 * The fix costs no plot width (an `XAxis padding` would have eaten ~26px of a
 * 302px plot): the two EDGE ticks stop being centred and anchor inward
 * instead — `start` for the first, `end` for the last. Every tick in between
 * keeps its centred anchor. The shift never makes a label point at the wrong
 * hour: anchoring inward moves it by at most half its own width, so it still
 * begins inside the band it names.
 */
interface AxisTickProps {
  x?: number
  y?: number
  index?: number
  visibleTicksCount?: number
  payload?: { value?: string | number }
}

function EdgeSafeAxisTick({ x = 0, y = 0, index = 0, visibleTicksCount = 0, payload }: AxisTickProps) {
  const isFirst = index === 0
  const isLast = visibleTicksCount > 0 && index === visibleTicksCount - 1
  const textAnchor = isFirst ? 'start' : isLast ? 'end' : 'middle'
  return (
    <text
      x={x}
      // `0.71em` is the exact offset Recharts' own `<Text verticalAnchor="start">`
      // emits, so the baseline does not move by a single pixel: measured
      // top/bottom of the label box relative to the SVG is 85.1 / 97.6 with the
      // stock renderer AND with this one. Only the horizontal anchor changes.
      y={y}
      dy="0.71em"
      textAnchor={textAnchor}
      fill={AXIS_TICK.fill}
      fontSize={AXIS_TICK.fontSize}
      fontFamily={AXIS_TICK.fontFamily}
    >
      {payload?.value}
    </text>
  )
}

/**
 * Dark, compact tooltip on the project tokens. Recharts' default is a white box
 * with a light border — unreadable on the sunken plane and off-palette.
 */
const TOOLTIP_STYLES = {
  contentStyle: {
    background: 'var(--color-zinc-900)',
    border: '1px solid var(--color-zinc-700)',
    borderRadius: 8,
    fontSize: 12,
    padding: '6px 10px',
  },
  labelStyle: { color: 'var(--color-zinc-400)', fontSize: 11, marginBottom: 2 },
  itemStyle: { color: 'var(--color-zinc-200)', fontSize: 12, padding: 0 },
  cursor: { fill: 'rgba(255,255,255,0.04)' },
} as const

export interface HourlyStatusPoint {
  /** "HH:00" UTC — pre-formatted server-side so the client does no date math. */
  label: string
  completed: number
  failed: number
  other: number
}

/**
 * Stacked hourly runs histogram (completed / failed / other). Replaces
 * `StackedHourBars` + `ChartGrid` + `HourLabelRail`.
 */
export function HourlyRunsChart({ data, ariaLabel }: { data: HourlyStatusPoint[]; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} className={PLOT_BOX} style={{ height: PLOT_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
          barCategoryGap="18%"
          aria-label={ariaLabel}
        >
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={<EdgeSafeAxisTick />}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={5}
            height={16}
          />
          <Tooltip {...TOOLTIP_STYLES} />
          <Bar dataKey="completed" stackId="runs" name="Completed" fill={SUCCESS} radius={[0, 0, 0, 0]} />
          <Bar dataKey="failed" stackId="runs" name="Failed" fill={SERIES} radius={[0, 0, 0, 0]} />
          <Bar dataKey="other" stackId="runs" name="Other" fill={OTHER} radius={[1, 1, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface HourlyCostPoint {
  label: string
  /** Measured spend for the hour, USD. Never a fabricated zero — see the caller. */
  costUsd: number
  measuredRunCount: number
}

/**
 * USD formatting lives HERE, not in the Server Component.
 *
 * A formatter cannot cross the server/client boundary: React refuses to
 * serialize a function prop, and the whole chart falls into its error boundary
 * at runtime (invisible to build, typecheck and the DOM tests — caught only by
 * loading the page). Keep it in the client module and pass data, never
 * behaviour.
 */
function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 4 : 2)}`
}

/**
 * Hourly measured-cost area. Replaces the hand-rolled `<polygon>` + `<polyline>`
 * pair. The caller renders an EmptyState when NO run in the window carries a
 * measured cost, so a flat zero line never stands in for missing data.
 */
export function HourlyCostChart({ data, ariaLabel }: { data: HourlyCostPoint[]; ariaLabel: string }) {
  return (
    <div role="img" aria-label={ariaLabel} className={PLOT_BOX} style={{ height: PLOT_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} aria-label={ariaLabel}>
          <defs>
            <linearGradient id="cost-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SUCCESS} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={<EdgeSafeAxisTick />}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            interval={5}
            height={16}
          />
          <Tooltip
            {...TOOLTIP_STYLES}
            // Recharts types the tooltip value as `ValueType | undefined`
            // (a series can have no point for a given tick). Narrow it rather
            // than casting: a non-numeric value renders as UNAVAILABLE instead
            // of `$NaN`, which would read as a real measured zero.
            formatter={(value) => [typeof value === 'number' ? formatUsd(value) : '—', 'Cost']}
          />
          <Area
            type="monotone"
            dataKey="costUsd"
            name="Cost"
            stroke={SUCCESS}
            strokeWidth={2}
            fill="url(#cost-fill)"
            dot={false}
            activeDot={{ r: 3, fill: SUCCESS }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
