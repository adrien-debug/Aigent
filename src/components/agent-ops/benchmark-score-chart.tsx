'use client'

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'

export interface BenchmarkScoreDatum {
  model: string
  /** Composite 0..100 used for ranking candidates. */
  score: number
  /** 0..1 ratio. */
  accuracy: number
  costPerTask: number
  unsafe: number
  isBest: boolean
}

// One hue ramp for magnitude: winner step (--chart-success), all other bars
// (--chart-success-muted). Labels and ticks wear text tokens, never the series
// hue. All colors resolve from the chart tokens in globals.css — no hex here.
const WINNER_FILL = 'var(--chart-success)'
const BAR_FILL = 'var(--chart-success-muted)'
const LABEL_FILL = 'var(--chart-label)'
const TICK_FILL = 'var(--chart-axis)'
const GRID_STROKE = 'var(--chart-grid)'
const FONT_MONO = 'var(--font-mono)'

const ROW_HEIGHT = 40
const MARGIN = { top: 4, right: 40, bottom: 4, left: 0 }
const GRID_TICKS = [25, 50, 75, 100]

function TooltipRow({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'danger' }) {
  return (
    <div className="flex items-baseline justify-between gap-x-4">
      <dt className="text-zinc-400">{label}</dt>
      <dd className={tone === 'danger' ? 'font-mono tabular-nums text-rose-400' : 'font-mono text-zinc-100 tabular-nums'}>
        {value}
      </dd>
    </div>
  )
}

function ScoreTooltip({ active, payload }: { active?: boolean; payload?: ReadonlyArray<{ payload?: unknown }> }) {
  if (!active || !payload || payload.length === 0) return null
  const datum = payload[0]?.payload as BenchmarkScoreDatum | undefined
  if (!datum) return null

  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2 text-xs ring-1 ring-white/10">
      <p className="mb-1.5 font-mono font-medium text-zinc-100">{datum.model}</p>
      <dl className="space-y-1">
        <TooltipRow label="Score" value={`${datum.score} / 100`} />
        <TooltipRow label="Accuracy" value={formatPercent(datum.accuracy)} />
        <TooltipRow label="Cost / task" value={formatUsd(datum.costPerTask)} />
        <TooltipRow label="Unsafe" value={String(datum.unsafe)} tone={datum.unsafe > 0 ? 'danger' : 'default'} />
      </dl>
    </div>
  )
}

/**
 * Horizontal bar chart ranking benchmark candidates by composite score (0–100).
 * Magnitude encoding on a single hue ramp; the winner bar takes the lighter
 * step. One axis (models as category ticks), grid reduced to four hairlines,
 * direct score labels at every bar end, no legend (single measure).
 */
export function BenchmarkScoreChart({ data }: { data: BenchmarkScoreDatum[] }) {
  if (data.length === 0) return null

  const rows = [...data].sort((a, b) => b.score - a.score)
  const height = rows.length * ROW_HEIGHT + MARGIN.top + MARGIN.bottom
  // 12px mono glyphs ≈ 7.2px wide; size the category gutter to the longest name.
  const longestModel = rows.reduce((max, row) => Math.max(max, row.model.length), 0)
  const yAxisWidth = Math.min(224, Math.max(80, Math.ceil(longestModel * 7.2) + 12))

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={MARGIN} barCategoryGap={2}>
        <XAxis type="number" domain={[0, 100]} hide />
        <YAxis
          type="category"
          dataKey="model"
          width={yAxisWidth}
          tickLine={false}
          axisLine={false}
          tick={{ fill: TICK_FILL, fontSize: 12, fontFamily: FONT_MONO }}
        />
        {GRID_TICKS.map((tick) => (
          <ReferenceLine key={tick} x={tick} stroke={GRID_STROKE} />
        ))}
        <Tooltip content={<ScoreTooltip />} cursor={{ fill: 'var(--chart-hover)' }} />
        <Bar dataKey="score" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell key={row.model} fill={row.isBest ? WINNER_FILL : BAR_FILL} />
          ))}
          <LabelList dataKey="score" position="right" offset={8} fill={LABEL_FILL} fontSize={12} fontFamily={FONT_MONO} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}
