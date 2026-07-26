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

const GRID = 'var(--chart-grid)'
const SUCCESS = 'var(--chart-success)'
const SERIES = 'var(--chart-series)'
const OTHER = 'var(--color-zinc-600)'

const AXIS_TICK = { fill: 'var(--color-zinc-500)', fontSize: 10, fontFamily: 'var(--font-mono)' } as const

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
    <div role="img" aria-label={ariaLabel} style={{ height: PLOT_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
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
    <div role="img" aria-label={ariaLabel} style={{ height: PLOT_HEIGHT }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="cost-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SUCCESS} stopOpacity={0.22} />
              <stop offset="100%" stopColor={SUCCESS} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="label"
            tick={AXIS_TICK}
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
