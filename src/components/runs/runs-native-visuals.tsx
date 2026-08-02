import { Badge } from '@/components/ui/badge'
import { Text } from '@/components/ui/text'
import { SEVERITY } from '@/components/cockpit/primitives'
import { RUN_STATUS_COLOR } from '@/lib/cockpit/status'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import { buildRunsHourlyBuckets } from '@/lib/runs-console/runs-timeseries'

export type DataGrade = 'LIVE' | 'SNAPSHOT' | 'DEMO' | 'UNAVAILABLE' | 'ERROR'

function gradeBadgeColor(grade: DataGrade): 'emerald' | 'blue' | 'amber' | 'zinc' | 'red' {
  if (grade === 'LIVE') return 'emerald'
  if (grade === 'SNAPSHOT') return 'blue'
  if (grade === 'DEMO') return 'amber'
  if (grade === 'UNAVAILABLE') return 'zinc'
  return 'red'
}

export function SourceGrade({
  grade,
  label,
}: Readonly<{
  grade: DataGrade
  label: string
}>) {
  return (
    <Badge color={gradeBadgeColor(grade)} title={label}>
      {grade}
    </Badge>
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

export function RunsActivityCanvas({
  runs,
  nowMs,
}: Readonly<{
  runs: AgentRun[]
  nowMs: number
}>) {
  if (runs.length === 0) {
    return (
      <div className="flex h-full min-h-44 flex-col items-center justify-center gap-2">
        <div className="flex items-center gap-2">
          <SourceGrade grade="SNAPSHOT" label="Fenêtre lue, aucune activité" />
          <Text className="text-xs">Fenêtre 24 h</Text>
        </div>
        <Text className="text-sm">Aucun run observé sur la fenêtre lue.</Text>
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
    <div className="flex min-h-48 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SourceGrade grade="SNAPSHOT" label="Série issue des runs persistés" />
        <Text className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Activité horaire</Text>
      </div>
      <svg viewBox="0 0 100 40" className="h-48 w-full">
        <defs>
          <linearGradient id="runs-activity-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SEVERITY.good} stopOpacity="0.28" />
            <stop offset="100%" stopColor={SEVERITY.good} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 12, 24, 36].map((y) => (
          <line
            key={y}
            x1="0"
            y1={y}
            x2="100"
            y2={y}
            className="text-(--aig-line-soft)"
            stroke="currentColor"
            strokeDasharray="1.6 2.4"
          />
        ))}
        <path d={area} fill="url(#runs-activity-fill)" />
        <path d={runLine} fill="none" stroke={SEVERITY.good} strokeWidth="1.1" strokeLinecap="round" />
        <path d={errorLine} fill="none" stroke={SEVERITY.bad} strokeWidth="0.9" strokeLinecap="round" />
      </svg>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <p className="aig-text-muted">
          Pic: <span className="aig-display tabular-nums">{peak}</span>/h
        </p>
        <p className="aig-text-muted">
          Dernière heure: <span className="aig-display tabular-nums">{last}</span>
        </p>
        <p className="aig-text-muted">
          Échelle: <span className="aig-display">UTC</span>
        </p>
      </div>
      <div className="mt-2 flex justify-between text-(--aig-text-faint) text-[10px] tabular-nums">
        <span>{series.xLabels[0] ?? '--:--'}</span>
        <span>{series.xLabels[Math.floor(series.xLabels.length / 2)] ?? '--:--'}</span>
        <span>{series.xLabels[series.xLabels.length - 1] ?? '--:--'}</span>
      </div>
    </div>
  )
}

export function RunsTerminalStrip({
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
  const ordered = p95Samples.toSorted((a, b) => a - b)
  const p95 =
    ordered.length > 0
      ? ordered[Math.floor(0.95 * (ordered.length - 1))]
      : null

  /*
   * Légende et rails parlent la MÊME langue — celle de `RUN_STATUS_COLOR`.
   *
   * Cette liste avait divergé de l'autorité sur deux entrées : « Bloqués » en
   * `warn` (l'ambre d'un avertissement pour un verdict terminal) et
   * « Confirmation » en `muted`. Une légende qui peint un statut autrement que
   * le rail de la ligne qu'elle légende n'est plus une légende.
   */
  const rows = [
    { label: 'Terminés', count: statusCounts.completed, color: RUN_STATUS_COLOR.completed },
    { label: 'Échecs', count: statusCounts.failed, color: RUN_STATUS_COLOR.failed },
    { label: 'Bloqués', count: statusCounts.blocked, color: RUN_STATUS_COLOR.blocked },
    { label: 'En cours', count: statusCounts.running, color: RUN_STATUS_COLOR.running },
    {
      label: 'Confirmation',
      count: statusCounts.needsConfirmation,
      color: RUN_STATUS_COLOR['needs-confirmation'],
    },
  ]

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <SourceGrade grade="SNAPSHOT" label="Répartition calculée sur la fenêtre" />
        <Text className="aig-text-faint text-2xs uppercase tracking-[0.14em]">Santé terminale</Text>
      </div>
      <div className="space-y-2.5">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-xs">
              <span className="aig-text-muted">{row.label}</span>
              <span className="aig-display tabular-nums">{row.count}</span>
            </div>
            <div className="h-1 rounded-full bg-(--aig-line-soft)">
              <div
                className="h-full rounded-full"
                style={{ width: `${(row.count / total) * 100}%`, backgroundColor: row.color }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        <p className="aig-text-muted">p95 latence</p>
        <p className="text-right tabular-nums">{formatDuration(p95) ?? 'Non mesuré'}</p>
      </div>
    </div>
  )
}
