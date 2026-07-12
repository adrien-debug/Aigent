'use client'

import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'

export interface RunLatencyPoint {
  id: string
  /** Short started-time label, e.g. "Jul 9, 07:12" — used for axis ticks and tooltip. */
  label: string
  latencyMs: number
  costUsd: number
  status: string
}

/** Latency line in the brand accent (directive Adrien 2026-07-11) — the chart is
 *  the coloured focal point of the dashboard. `--chart-success` = accent hue. */
const SERIES_STROKE = 'var(--chart-success)'

const tickStyle = { fontSize: 12, fill: 'var(--chart-tick)' } as const

/** Status is signaled by TEXT; the accent hue only tints the tooltip status text. */
function isFailedOrBlocked(status: string): boolean {
  return status === 'failed' || status === 'blocked'
}

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function LatencyTooltip({ active, payload }: TooltipContentProps) {
  const point = active && payload && payload.length > 0 ? (payload[0].payload as RunLatencyPoint) : null
  if (!point) return null

  return (
    <div className="rounded-lg px-3 py-2 text-xs ring-1 ring-white/10" style={{ backgroundColor: 'var(--chart-surface)' }}>
      <p className="font-mono font-medium tabular-nums text-white">
        {point.id}
        <span className="ml-2 font-normal text-zinc-400">{point.label}</span>
      </p>
      <dl className="mt-1.5 min-w-36 space-y-1">
        <div className="flex items-baseline justify-between gap-6">
          <dt className="text-zinc-400">Latency</dt>
          <dd className="font-mono tabular-nums text-white">{formatDurationMs(point.latencyMs)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-6">
          <dt className="text-zinc-400">Cost</dt>
          <dd className="font-mono tabular-nums text-white">{formatUsd(point.costUsd)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-6">
          <dt className="text-zinc-400">Status</dt>
          <dd className={isFailedOrBlocked(point.status) ? 'text-accent-400' : 'text-zinc-300'}>
            {statusLabel(point.status)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

/**
 * Single-series latency line, oldest → newest. One axis, horizontal grid only,
 * no legend (the card title names the series), crosshair + dark tooltip panel.
 */
export function RunLatencyChart({ data }: { data: RunLatencyPoint[] }) {
  const gradientId = useId()
  // Category axis stays sparse: ~4 tick labels max regardless of run count.
  const tickInterval = Math.max(0, Math.ceil(data.length / 4) - 1)

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_STROKE} stopOpacity={0.08} />
            <stop offset="100%" stopColor={SERIES_STROKE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval={tickInterval}
          tick={tickStyle}
          tickMargin={8}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={44}
          tick={tickStyle}
          tickFormatter={(value: number) => formatDurationMs(value)}
        />
        <Tooltip cursor={{ stroke: 'var(--chart-cursor)' }} content={LatencyTooltip} isAnimationActive={false} />
        <Area
          type="monotone"
          dataKey="latencyMs"
          stroke={SERIES_STROKE}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: SERIES_STROKE, stroke: 'var(--chart-surface)', strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
