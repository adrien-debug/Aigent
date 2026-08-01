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
 */
import { Badge } from '@/components/ui/badge'
import { Strong, Text } from '@/components/ui/text'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun } from '@/lib/agent-mission-control/types'
import { formatDuration } from '@/lib/runs-console/runs-metrics'
import { AbsentMark, Rail, SEVERITY } from '@/components/cockpit/primitives'
import { RUN_STATUS_BADGE, RUN_STATUS_LABEL } from './run-view-model'

const RAIL_COLOR: Record<AgentRun['status'], string> = {
  completed: SEVERITY.good,
  running: SEVERITY.running,
  failed: SEVERITY.bad,
  blocked: SEVERITY.warn,
  'needs-confirmation': SEVERITY.muted,
}

function RunRow({
  run,
  agentName,
  selected,
  href,
}: Readonly<{
  run: AgentRun
  agentName: string | null
  selected: boolean
  href: string
}>) {
  const duration = formatDuration(run.latencyMs)

  return (
    <li className="relative">
      {/* Le rail de SÉVÉRITÉ reste collé au bord — c'est l'état du run, pas la
          sélection. La sélection, elle, prend le relief et le cuivre : un seul
          point focal par liste, et deux signaux qui ne se confondent pas. */}
      <Rail color={RAIL_COLOR[run.status]} />
      {selected ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0.5 w-0.5 bg-[color:var(--aig-accent)]"
        />
      ) : null}
      {/* `aria-current` porte la sélection pour l'assistance vocale ; la teinte
          seule ne suffirait pas à la dire. */}
      <a
        href={href}
        aria-current={selected ? 'true' : undefined}
        className={
          selected ? 'aig-raised block py-2.5 pr-3 pl-3' : 'block py-2.5 pr-3 pl-3 hover:bg-white/5'
        }
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
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
}: Readonly<{
  runs: AgentRun[]
  agentNameById: Map<string, string>
  selectedRunId: string | null
  /** Construit le lien profond d'un run en préservant les filtres de l'URL. */
  buildHref: (runId: string) => string
}>) {
  return (
    <ul className="divide-y divide-[color:var(--aig-line-soft)]">
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
