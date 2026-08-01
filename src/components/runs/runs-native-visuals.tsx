import type { AgentRun } from '@/lib/agent-mission-control/types'
import { buildRunsHourlyBuckets } from '@/lib/runs-console/runs-timeseries'
import { formatDuration } from '@/lib/runs-console/runs-metrics'

type DataGrade = 'LIVE' | 'SNAPSHOT' | 'DEMO' | 'UNAVAILABLE' | 'ERROR'

function gradeTone(grade: DataGrade): string {
  if (grade === 'LIVE') return 'text-emerald-300 border-emerald-400/35 bg-emerald-400/10'
  if (grade === 'SNAPSHOT') return 'text-sky-300 border-sky-400/35 bg-sky-400/10'
  if (grade === 'DEMO') return 'text-amber-300 border-amber-400/35 bg-amber-400/10'
  if (grade === 'UNAVAILABLE') return 'text-zinc-300 border-zinc-500/40 bg-zinc-500/10'
  return 'text-red-300 border-red-400/35 bg-red-400/10'
}

export function GradeBadge({
  grade,
  label,
}: Readonly<{
  grade: DataGrade
  label: string
}>) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] uppercase ${gradeTone(grade)}`}
      title={label}
    >
      {grade}
    </span>
  )
}

function bucketedRuns(runs: AgentRun[], nowMs: number) {
  const spanMs = 24 * 60 * 60 * 1000
  return buildRunsHourlyBuckets(runs, nowMs, spanMs)
}

function svgPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const max = Math.max(1, ...values)
  const stepX = values.length > 1 ? width / (values.length - 1) : width
  return values
    .map((v, i) => {
      const x = i * stepX
      const y = height - (v / max) * height
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function areaPath(values: number[], width: number, height: number): string {
  if (values.length === 0) return ''
  const line = svgPath(values, width, height)
  return `${line} L ${width} ${height} L 0 ${height} Z`
}

export function RunsActivityCard({
  runs,
  nowMs,
}: Readonly<{
  runs: AgentRun[]
  nowMs: number
}>) {
  if (runs.length === 0) {
    return (
      <div className="aig-subtle rounded-lg p-4">
        <div className="flex items-center gap-2">
          <GradeBadge grade="SNAPSHOT" label="Fenêtre lue, aucune activité" />
          <p className="aig-text-muted text-xs">Fenêtre 24 h</p>
        </div>
        <p className="aig-text-muted mt-2 text-sm">Aucun run observé sur la fenêtre lue.</p>
      </div>
    )
  }

  const series = bucketedRuns(runs, nowMs)
  const runLine = svgPath(series.runsPerHour, 100, 36)
  const errorLine = svgPath(series.errorsPerHour, 100, 36)
  const area = areaPath(series.runsPerHour, 100, 36)
  const peak = Math.max(...series.runsPerHour)
  const last = series.runsPerHour[series.runsPerHour.length - 1] ?? 0

  return (
    <div className="aig-subtle rounded-lg p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <GradeBadge grade="SNAPSHOT" label="Série issue des runs persistés" />
        <p className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Activité horaire</p>
      </div>
      <svg viewBox="0 0 100 40" className="h-36 w-full">
        <defs>
          <linearGradient id="runs-activity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(52 211 153 / 0.35)" />
            <stop offset="100%" stopColor="rgb(52 211 153 / 0)" />
          </linearGradient>
        </defs>
        {[0, 12, 24, 36].map((y) => (
          <line key={y} x1="0" y1={y} x2="100" y2={y} className="stroke-white/8" strokeDasharray="1.6 2.4" />
        ))}
        <path d={area} fill="url(#runs-activity-fill)" />
        <path d={runLine} fill="none" stroke="rgb(52 211 153)" strokeWidth="1.1" strokeLinecap="round" />
        <path d={errorLine} fill="none" stroke="rgb(248 113 113)" strokeWidth="0.9" strokeLinecap="round" />
      </svg>
      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <p className="aig-text-muted">Pic: <span className="tabular-nums text-white">{peak}</span>/h</p>
        <p className="aig-text-muted">Dernière heure: <span className="tabular-nums text-white">{last}</span></p>
        <p className="aig-text-muted">Échelle: <span className="text-white">UTC</span></p>
      </div>
      <div className="mt-2 flex justify-between text-(--aig-text-faint) text-[10px] tabular-nums">
        <span>{series.xLabels[0] ?? '--:--'}</span>
        <span>{series.xLabels[Math.floor(series.xLabels.length / 2)] ?? '--:--'}</span>
        <span>{series.xLabels[series.xLabels.length - 1] ?? '--:--'}</span>
      </div>
    </div>
  )
}

export function RunsHealthCard({
  runs,
}: Readonly<{
  runs: AgentRun[]
}>) {
  const total = Math.max(1, runs.length)
  const statusCounts = {
    completed: 0,
    failed: 0,
    blocked: 0,
    running: 0,
    needsConfirmation: 0,
  }
  const p95Samples: number[] = []
  for (const run of runs) {
    if (run.status === 'completed') statusCounts.completed += 1
    if (run.status === 'failed') statusCounts.failed += 1
    if (run.status === 'blocked') statusCounts.blocked += 1
    if (run.status === 'running') statusCounts.running += 1
    if (run.status === 'needs-confirmation') statusCounts.needsConfirmation += 1
    if (typeof run.latencyMs === 'number' && Number.isFinite(run.latencyMs)) {
      p95Samples.push(run.latencyMs)
    }
  }
  p95Samples.sort((a, b) => a - b)
  const p95 =
    p95Samples.length > 0
      ? p95Samples[Math.floor(0.95 * (p95Samples.length - 1))]
      : null

  const rows = [
    { label: 'Terminés', count: statusCounts.completed, color: 'bg-emerald-400/80' },
    { label: 'Échecs', count: statusCounts.failed, color: 'bg-red-400/80' },
    { label: 'Bloqués', count: statusCounts.blocked, color: 'bg-amber-400/80' },
    { label: 'En cours', count: statusCounts.running, color: 'bg-sky-400/80' },
    { label: 'Confirmation', count: statusCounts.needsConfirmation, color: 'bg-zinc-400/80' },
  ]

  return (
    <div className="aig-subtle rounded-lg p-3">
      <div className="mb-2 flex items-center gap-2">
        <GradeBadge grade="SNAPSHOT" label="Répartition calculée sur la fenêtre" />
        <p className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Santé terminale</p>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="aig-text-muted">{row.label}</span>
              <span className="tabular-nums text-white">{row.count}</span>
            </div>
            <div className="h-1.5 rounded-full bg-white/10">
              <div className={`${row.color} h-full rounded-full`} style={{ width: `${(row.count / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <p className="aig-text-muted">p95 latence</p>
        <p className="text-right tabular-nums text-white">{formatDuration(p95) ?? 'Non mesuré'}</p>
      </div>
    </div>
  )
}
