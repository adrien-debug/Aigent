'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

export interface TestPassTrendPoint {
  runId: string
  startedAt: string
  label: string
  passRate: number
  costUsd: number
  triggeredBy: string
}

// Pass rate is a success measure (doctrine) → --chart-success. All colors come
// from the chart tokens in globals.css — no hex, light+dark aware.
const SERIES_COLOR = 'var(--chart-success)'
const TICK_COLOR = 'var(--chart-tick)'
const GRID_STROKE = 'var(--chart-grid)'
const CURSOR_STROKE = 'var(--chart-cursor)'

function TrendTooltip({ active, payload }: TooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null
  const point = payload[0]?.payload as TestPassTrendPoint | undefined
  if (!point) return null

  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2 text-xs ring-1 ring-white/10">
      <p className="text-zinc-400">
        {point.label} · {point.triggeredBy}
      </p>
      <p className="mt-1 font-mono tabular-nums text-white">{formatPercent(point.passRate)} pass</p>
      <p className="font-mono tabular-nums text-zinc-400">{formatUsd(point.costUsd)} total cost</p>
    </div>
  )
}

export function TestPassTrendChart({ data }: { data: TestPassTrendPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID_STROKE} />
        <XAxis dataKey="label" hide padding={{ left: 8, right: 8 }} />
        <YAxis
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(value: number) => formatPercent(value, 0)}
          tick={{ fontSize: 12, fill: TICK_COLOR }}
          axisLine={false}
          tickLine={false}
          width={40}
        />
        <Tooltip cursor={{ stroke: CURSOR_STROKE }} content={TrendTooltip} />
        <Line
          type="linear"
          dataKey="passRate"
          stroke={SERIES_COLOR}
          strokeWidth={2}
          dot={{ r: 3, fill: SERIES_COLOR, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: SERIES_COLOR, strokeWidth: 0 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
