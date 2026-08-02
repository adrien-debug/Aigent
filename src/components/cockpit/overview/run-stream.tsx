import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { SeverityChip, type SeverityTone } from '@/components/surface-primitives'
import { AbsentMark } from '@/components/cockpit/primitives'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import { clockTime } from '@/lib/cockpit/named-runs'
import { RUN_STATUS_SINGULAR } from '@/lib/cockpit/status'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

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

/**
 * Flux d'exécution de l'Aperçu — QUATRE colonnes, pas six.
 *
 * Le tableau portait `Heure · Statut · Agent · Durée · Coût · Il y a`. Dans la
 * colonne de l'Aperçu (438 px mesurés à 1280), six colonnes réclament 538 px :
 * le `bleed` de Catalyst basculait alors en `overflow-x-auto` et cachait 100 px
 * de contenu derrière un défilement horizontal, à l'intérieur d'une colonne.
 *
 * Les deux colonnes retirées sont celles que la page dit DÉJÀ ailleurs :
 * « Coût » est un rang du bandeau de mesures (« Coût 24 h »), et « Il y a »
 * redouble « Heure » sur la même fenêtre de 24 h. Rien n'est perdu : le flux
 * complet, coût par run inclus, vit sur `/runs`, vers lequel la section pointe.
 */
export default function RunStream({ runs }: Readonly<{ runs: NamedRun[] }>) {
  return (
    <Table dense>
      <TableHead>
        <TableRow>
          {/* Sous `sm`, la colonne ne fait plus que 290 px : trois colonnes en
              `whitespace-nowrap` y réclamaient 306 px et rouvraient un
              défilement horizontal DANS la section. L'heure exacte est ce qui
              se retire le mieux — la liste reste chronologique, et le flux
              horodaté complet vit sur `/runs`. */}
          <TableHeader className="hidden sm:table-cell">Heure</TableHeader>
          <TableHeader className="hidden sm:table-cell">Statut</TableHeader>
          <TableHeader>Agent</TableHeader>
          <TableHeader className="text-right">Durée</TableHeader>
        </TableRow>
      </TableHead>

      <TableBody>
        {runs.map((run) => (
          <TableRow key={run.id}>
            <TableCell className="aig-text hidden tabular-nums sm:table-cell">
              {clockTime(run.startedAtMs)}
            </TableCell>
            <TableCell className="hidden sm:table-cell">
              <SeverityChip tone={STATUS_TONE[run.status]}>
                {RUN_STATUS_SINGULAR[run.status]}
              </SeverityChip>
            </TableCell>
            {/*
              `w-full max-w-0` — la seule façon de rendre `truncate` RÉEL dans
              cette table. Le wrapper Catalyst pose `overflow-x-auto` et la
              table reste en `min-w-full` auto-layout : la largeur de cette
              cellule est alors dictée par le max-content de son texte, et un
              `truncate` sans largeur contrainte ne tronque rien. Retirer des
              colonnes abaisse le seuil mais ne borne jamais la colonne
              élastique — un `copilotId` non résolu (`copilot-<slug>-<rand>`,
              ~68 caractères) suffit à rouvrir le défilement horizontal DANS la
              section. `max-w-0` donne au navigateur une base à contraindre,
              `w-full` lui rend l'espace disponible.
            */}
            <TableCell className="w-full max-w-0">
              {run.copilotName ? (
                <span className="aig-text block truncate font-medium">{run.copilotName}</span>
              ) : (
                <span className="aig-text-muted block truncate text-sm">{run.copilotId}</span>
              )}
              <span className="aig-text-muted block truncate text-xs">
                {run.projectName ?? 'sans projet'}
              </span>
            </TableCell>
            <TableCell className="aig-text text-right tabular-nums">
              {run.latencyMs === null ? <AbsentMark /> : duration(run.latencyMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
