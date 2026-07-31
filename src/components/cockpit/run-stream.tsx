/**
 * Flux d'exécution — `Table` Catalyst officielle, sans aucune retouche du kit.
 *
 * Le kit n'a pas d'option « table bornée » : le défilement vertical est donc
 * porté par le CONTENEUR (`overflow-y-auto` dans le panneau), pas par une prop
 * ajoutée à `Table`. C'est la règle de la voie A — on compose autour du kit,
 * on ne le modifie pas.
 *
 * Une mesure absente reste absente : ni « 0 ms », ni « $0.00 ».
 */
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { clockTime, timeAgo } from '@/lib/cockpit/named-runs'
import { RUN_STATUS_SINGULAR } from '@/lib/cockpit/status'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'
import { AbsentMark } from './primitives'

/** Le statut d'un run — couleur ET mot portés par le `Badge` Catalyst. */
const STATUS_BADGE: Record<AgentRunStatus, 'emerald' | 'blue' | 'amber' | 'purple' | 'red'> = {
  completed: 'emerald',
  running: 'blue',
  'needs-confirmation': 'amber',
  blocked: 'purple',
  failed: 'red',
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
            <TableCell className="tabular-nums">{clockTime(run.startedAtMs)}</TableCell>

            <TableCell className="hidden sm:table-cell">
              <Badge color={STATUS_BADGE[run.status]}>{RUN_STATUS_SINGULAR[run.status]}</Badge>
            </TableCell>

            <TableCell>
              {run.copilotName ? (
                <Strong className="truncate">{run.copilotName}</Strong>
              ) : (
                <Text className="truncate">{run.copilotId}</Text>
              )}
              <Text className="truncate">{run.projectName ?? 'sans projet'}</Text>
            </TableCell>

            <TableCell className="text-right tabular-nums">
              {run.latencyMs === null ? <AbsentMark /> : duration(run.latencyMs)}
            </TableCell>

            <TableCell className="text-right tabular-nums">
              {run.costUsd === null ? <AbsentMark /> : formatUsd(run.costUsd)}
            </TableCell>

            <TableCell className="text-right whitespace-nowrap">
              {timeAgo(run.startedAtMs, nowMs).replace('il y a ', '')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
