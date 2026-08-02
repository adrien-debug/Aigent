/**
 * Flux d'exécution — table Catalyst pour la structure tabulaire, donnée en `aig-*`.
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SeverityChip, type SeverityTone } from '@/components/surface-primitives'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { clockTime, timeAgo } from '@/lib/cockpit/named-runs'
import { RUN_STATUS_SINGULAR } from '@/lib/cockpit/status'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'
import { AbsentMark } from './primitives'

const STATUS_TONE: Record<AgentRunStatus, SeverityTone> = {
  completed: 'good',
  running: 'running',
  'needs-confirmation': 'warn',
  blocked: 'blocked',
  failed: 'bad',
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`
}

export default function RunStream({ runs, nowMs }: Readonly<{ runs: NamedRun[]; nowMs: number }>) {
  return (
    <Table dense bleed>
      <TableHead>
        <TableRow>
          <TableHeader>Heure</TableHeader>
          <TableHeader className="hidden sm:table-cell">Statut</TableHeader>
          <TableHeader>Agent</TableHeader>
          <TableHeader className="text-right">Durée</TableHeader>
          <TableHeader className="text-right">Coût</TableHeader>
          <TableHeader className="text-right">Il y a</TableHeader>
        </TableRow>
      </TableHead>

      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="aig-text tabular-nums">{clockTime(run.startedAtMs)}</TableCell>

            <TableCell className="hidden sm:table-cell">
              <SeverityChip tone={STATUS_TONE[run.status]}>
                {RUN_STATUS_SINGULAR[run.status]}
              </SeverityChip>
            </TableCell>

            <TableCell>
              {run.copilotName ? (
                <span className="aig-text block truncate font-medium">{run.copilotName}</span>
              ) : (
                <span className="aig-text-muted block truncate text-sm">{run.copilotId}</span>
              )}
              <span className="aig-text-faint block truncate text-xs">
                {run.projectName ?? 'sans projet'}
              </span>
            </TableCell>

            <TableCell className="aig-text text-right tabular-nums">
              {run.latencyMs === null ? <AbsentMark /> : duration(run.latencyMs)}
            </TableCell>

            <TableCell className="aig-text text-right tabular-nums">
              {run.costUsd === null ? <AbsentMark /> : formatUsd(run.costUsd)}
            </TableCell>

            <TableCell className="aig-text-faint text-right whitespace-nowrap text-xs">
              {timeAgo(run.startedAtMs, nowMs).replace('il y a ', '')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
