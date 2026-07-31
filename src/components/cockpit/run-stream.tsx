/**
 * Flux d'exécution — ce qui SE PASSE, ligne à ligne, du plus récent au plus
 * ancien.
 *
 * Bâti sur la `Table` Catalyst (`dense`, `bounded`) : six colonnes tabulaires
 * réelles — heure, statut, agent, durée, coût, ancienneté. `bounded` garde
 * l'en-tête fixe et fait défiler le seul corps dans la hauteur du panneau,
 * sans quoi la table grandirait avec la donnée et casserait le zéro-scroll.
 *
 * Une mesure absente reste absente : ni « 0 ms », ni « $0.00 ».
 */
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { clockTime, timeAgo } from '@/lib/cockpit/named-runs'
import { RUN_STATUS_COLOR, RUN_STATUS_SINGULAR } from '@/lib/cockpit/status'
import { AbsentMark, Led } from './primitives'

function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  const s = ms / 1000
  return s < 60 ? `${s.toFixed(1)} s` : `${Math.round(s / 60)} min`
}

export default function RunStream({ runs, nowMs }: { runs: NamedRun[]; nowMs: number }) {
  return (
    <Table dense bounded>
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
            <TableCell className="font-mono tabular-nums text-ink-faint">
              {clockTime(run.startedAtMs)}
            </TableCell>

            <TableCell className="hidden sm:table-cell">
              <span className="flex items-center gap-1.5">
                <Led color={RUN_STATUS_COLOR[run.status]} live={run.status === 'running'} />
                <span className="truncate text-ink-dim">{RUN_STATUS_SINGULAR[run.status]}</span>
              </span>
            </TableCell>

            <TableCell>
              <span className="flex min-w-0 items-baseline gap-1.5">
                {run.copilotName ? (
                  <Strong className="truncate text-[12.5px]">{run.copilotName}</Strong>
                ) : (
                  <span className="truncate font-mono text-ink-faint">{run.copilotId}</span>
                )}
                <Text className="truncate">{run.projectName ? `· ${run.projectName}` : '· sans projet'}</Text>
              </span>
            </TableCell>

            <TableCell className="text-right font-mono tabular-nums text-ink-dim">
              {run.latencyMs === null ? <AbsentMark /> : duration(run.latencyMs)}
            </TableCell>

            <TableCell className="text-right font-mono tabular-nums text-ink-dim">
              {run.costUsd === null ? <AbsentMark /> : formatUsd(run.costUsd)}
            </TableCell>

            <TableCell className="text-right font-mono whitespace-nowrap text-ink-faint">
              {timeAgo(run.startedAtMs, nowMs).replace('il y a ', '')}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
