/**
 * Liste des runs — la moitié gauche du maître-détail.
 *
 * Server Component. Chaque ligne est un `<Link>` vers `/runs?run=<id>` : la
 * sélection est portée par l'URL, pas par un état client. Conséquence directe et
 * voulue — la ligne sélectionnée est un lien réel, partageable, et le bouton
 * « retour » du navigateur remonte la sélection précédente. Un `onClick` sur un
 * état local aurait produit une sélection qu'aucun lien ne peut atteindre.
 *
 * Aucun `href="#"` : chaque ligne mène à un run qui existe dans la liste rendue.
 *
 * Le défilement appartient au CONTENEUR (`Panel` + `overflow-y-auto`), jamais à
 * la page — c'est ce qui tient le zéro-scroll desktop.
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import { AbsentMark, Rail } from '@/components/cockpit/primitives'
import { RUN_STATUS_BADGE, RUN_STATUS_LABEL } from './run-view-model'

/** Rail gris — la teinte « pas de signal », partagée avec les rosters du cockpit. */
const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

const RAIL_COLOR: Record<AgentRun['status'], string> = {
  completed: '#0da87f',
  running: '#3b9dd6',
  failed: '#e8455f',
  blocked: '#be850f',
  'needs-confirmation': MUTED_RAIL,
}

function RunRow({
  run,
  agentName,
  selected,
  href,
}: {
  run: AgentRun
  agentName: string | null
  selected: boolean
  href: string
}) {
  const duration = formatDuration(run.latencyMs)

  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={RAIL_COLOR[run.status]} />
      {/* `aria-current` porte la sélection pour l'assistance vocale ; la teinte
          seule ne suffirait pas à la dire. */}
      <a
        href={href}
        aria-current={selected ? 'true' : undefined}
        className={
          selected
            ? 'block bg-zinc-950/5 py-2.5 pr-4 pl-4 dark:bg-white/10'
            : 'block py-2.5 pr-4 pl-4 hover:bg-zinc-950/3 dark:hover:bg-white/5'
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <Badge color={RUN_STATUS_BADGE[run.status]}>{RUN_STATUS_LABEL[run.status]}</Badge>
          {agentName ? (
            <Strong className="truncate">{agentName}</Strong>
          ) : (
            // Roster non lu : l'id brut plutôt qu'un nom inventé.
            <Text className="truncate font-mono text-xs">{run.copilotId}</Text>
          )}
        </div>

        <div className="mt-0.5 flex min-w-0 items-baseline gap-2">
          <Text className="min-w-0 flex-1 truncate font-mono text-xs">{run.id}</Text>
          <Text className="shrink-0 tabular-nums">
            {duration ?? <AbsentMark />}
            {' · '}
            {run.costUsd === null ? <AbsentMark /> : formatUsd(run.costUsd)}
          </Text>
        </div>
      </a>
    </li>
  )
}

export default function RunList({
  runs,
  agentNameById,
  selectedRunId,
  buildHref,
}: {
  runs: AgentRun[]
  agentNameById: Map<string, string>
  selectedRunId: string | null
  /** Construit le lien profond d'un run en préservant les filtres de l'URL. */
  buildHref: (runId: string) => string
}) {
  return (
    <ul>
      {runs.map((run) => (
        <RunRow
          key={run.id}
          run={run}
          agentName={agentNameById.get(run.copilotId) ?? null}
          selected={run.id === selectedRunId}
          href={buildHref(run.id)}
        />
      ))}
    </ul>
  )
}
