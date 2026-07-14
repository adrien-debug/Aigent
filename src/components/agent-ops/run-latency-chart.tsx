'use client'

import { useId } from 'react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { TooltipContentProps } from 'recharts'

import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'

export interface RunLatencyPoint {
  id: string
  label: string
  latencyMs: number
  costUsd: number
  status: string
}

const SERIES_STROKE = 'var(--color-accent-500)'

const tickStyle = { fontSize: 10, fill: 'var(--chart-tick)', fontFamily: 'var(--font-mono)' } as const

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
    <div className="rounded-xl px-4 py-3 text-xs bg-black/80 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)]">
      <div className="flex items-center justify-between mb-2 pb-2 border-b border-white/10">
        <span className="font-mono font-medium text-white">{point.id}</span>
        <span className="font-mono text-zinc-500">{point.label}</span>
      </div>
      <dl className="min-w-[180px] space-y-2">
        <div className="flex items-center justify-between">
          <dt className="text-[10px] uppercase tracking-widest text-zinc-500">Latency</dt>
          <dd className="font-mono text-accent-400">{formatDurationMs(point.latencyMs)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[10px] uppercase tracking-widest text-zinc-500">Cost</dt>
          <dd className="font-mono text-white">{formatUsd(point.costUsd)}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-[10px] uppercase tracking-widest text-zinc-500">Status</dt>
          <dd className={isFailedOrBlocked(point.status) ? 'text-accent-400' : 'text-zinc-300'}>
            {statusLabel(point.status)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export function RunLatencyChart({ data }: { data: RunLatencyPoint[] }) {
  const gradientId = useId()
  const tickInterval = Math.max(0, Math.ceil(data.length / 6) - 1)

  return (
    <ResponsiveContainer width="100%" height={340}>
      <AreaChart data={data} margin={{ top: 24, right: 16, bottom: 8, left: -12 }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES_STROKE} stopOpacity={0.2} />
            <stop offset="100%" stopColor={SERIES_STROKE} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="4 4" />
        <XAxis
          dataKey="label"
          axisLine={false}
          tickLine={false}
          interval={tickInterval}
          tick={tickStyle}
          tickMargin={12}
        />
        <YAxis
          axisLine={false}
          tickLine={false}
          width={60}
          tick={tickStyle}
          tickFormatter={(value: number) => formatDurationMs(value)}
        />
        <Tooltip cursor={{ stroke: 'var(--chart-grid)', strokeWidth: 1, strokeDasharray: '4 4' }} content={LatencyTooltip} isAnimationActive={false} />
        <Area
          type="monotone"
          dataKey="latencyMs"
          stroke={SERIES_STROKE}
          strokeWidth={2}
          fill={`url(#${gradientId})`}
          dot={false}
          activeDot={{ r: 4, fill: SERIES_STROKE, stroke: 'var(--color-surface-canvas)', strokeWidth: 2 }}
          isAnimationActive={true}
          animationDuration={1000}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
