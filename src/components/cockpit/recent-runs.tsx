/**
 * Derniers runs — la table qui dit ce qui se passe, pas ce qui existe.
 *
 * `Table` de Catalyst, `dense` pour la densité d'un cockpit sans écraser la
 * typographie. Un run non résolu affiche son id plutôt qu'un nom inventé.
 */
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { timeAgo } from '@/lib/cockpit/named-runs'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

type BadgeColor = 'emerald' | 'sky' | 'amber' | 'violet' | 'rose'

const STATUS: Record<AgentRunStatus, { color: BadgeColor; label: string }> = {
  completed: { color: 'emerald', label: 'Terminé' },
  running: { color: 'sky', label: 'En cours' },
  'needs-confirmation': { color: 'amber', label: 'À confirmer' },
  blocked: { color: 'violet', label: 'Bloqué' },
  failed: { color: 'rose', label: 'Échoué' },
}

function fmtUsd(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`
}

export default function RecentRuns({ runs, nowMs }: { runs: NamedRun[]; nowMs: number }) {
  return (
    <Table dense grid className="[--gutter:--spacing(4)]">
      <TableHead>
        <TableRow>
          <TableHeader>Agent</TableHeader>
          <TableHeader>Statut</TableHeader>
          <TableHeader className="text-right">Durée</TableHeader>
          <TableHeader className="text-right">Coût</TableHeader>
          <TableHeader className="text-right">Quand</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {runs.map((run) => {
          const status = STATUS[run.status]
          return (
            <TableRow key={run.id}>
              <TableCell>
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">
                    {run.copilotName ?? <span className="text-zinc-500">{run.copilotId}</span>}
                  </p>
                  <Text className="truncate !text-xs !text-zinc-500">
                    {run.projectName ?? 'Sans projet'}
                  </Text>
                </div>
              </TableCell>
              <TableCell>
                <Badge color={status.color}>{status.label}</Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums text-zinc-300">
                {run.latencyMs === null ? (
                  <span className="text-zinc-600">{UNAVAILABLE_LABEL}</span>
                ) : (
                  fmtDuration(run.latencyMs)
                )}
              </TableCell>
              <TableCell className="text-right tabular-nums text-zinc-300">
                {run.costUsd === null ? (
                  <span className="text-zinc-600">{UNAVAILABLE_LABEL}</span>
                ) : (
                  fmtUsd(run.costUsd)
                )}
              </TableCell>
              <TableCell className="text-right whitespace-nowrap text-zinc-400">
                {timeAgo(run.startedAtMs, nowMs)}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
