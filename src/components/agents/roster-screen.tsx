/**
 * Roster des agents — écran à hauteur bornée, la liste défile DANS sa box.
 *
 * Server Component : il reçoit le contrat canonique déjà lu et le distribue. Il
 * ne lit rien lui-même et ne recalcule aucun statut — `AvailableAgent.status`
 * est la même dérivation que la garde d'exécution, et la recalculer ici est
 * exactement comme un écran a fini par promettre un lancement que l'API
 * refusait.
 *
 * Chaque ligne mène à `/agents/[copilotId]` — un lien réel, jamais un `#`.
 */
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { Panel, Rail, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { LifecycleStatusBadge, ProviderBadge, RuntimeStatusBadge } from './atoms'
import { countRoster, isUnavailable, sortRoster, unresolvedToolsBadgeText } from './roster-model'

const MUTED_RAIL = 'rgb(161 161 170 / 0.35)'

/** Le rail reprend la gravité du statut runtime — la même que le badge. */
const RAIL_COLOR: Record<AvailableAgent['status'], string> = {
  active: '#0da87f',
  inactive: MUTED_RAIL,
  degraded: '#e8455f',
  unavailable: '#be850f',
}

function AgentRosterRow({ agent }: Readonly<{ agent: AvailableAgent }>) {
  const unresolved = agent.unresolvedToolIds.length
  // `version` peut être absent : c'est une des exigences dures dont l'absence
  // rend l'agent `unavailable`. On le dit, on n'invente pas de « v1 ».
  const versionMissing = isUnavailable(agent, 'version')

  return (
    <li className="relative border-b border-zinc-950/5 last:border-b-0 dark:border-white/5">
      <Rail color={RAIL_COLOR[agent.status]} />
      {/* Le lien couvre la ligne entière : la cible est la fiche de l'agent. */}
      <Link
        href={`/agents/${agent.copilotId}`}
        className="flex items-center gap-3 py-2.5 pr-4 pl-4 hover:bg-zinc-950/[0.025] dark:hover:bg-white/[0.025]"
      >
        <Avatar square initials={initialsOf(agent.name)} className="size-8 shrink-0" />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Strong className="truncate">{agent.name}</Strong>
            <RuntimeStatusBadge status={agent.status} />
            <LifecycleStatusBadge status={agent.lifecycleStatus} />
            {unresolved > 0 ? (
              <Badge
                color="red"
                title="Des outils déclarés ne résolvent vers aucun handler enregistré : l’agent ne peut pas faire ce qu’il annonce."
              >
                {unresolvedToolsBadgeText(unresolved)}
              </Badge>
            ) : null}
          </div>
          <Text className="truncate">
            {versionMissing ? 'version non résolue' : agent.version}
            {agent.versionStage ? ` · ${agent.versionStage}` : ''}
            {' · '}
            {agent.runtime ?? 'runtime non résolu'}
          </Text>
        </div>

        <div className="hidden shrink-0 items-center gap-2 sm:flex">
          <ProviderBadge provider={agent.provider} />
          {/* `executable` est la règle de la garde d'exécution, dite en un mot.
              Il est plus étroit que « actif » : on ne les confond pas. */}
          <Badge
            color={agent.executable ? 'emerald' : 'zinc'}
            title={
              agent.executable
                ? 'La garde d’exécution accepterait un lancement maintenant : actif, tous les outils résolus, runtime langgraph.'
                : 'La garde d’exécution refuserait un lancement. La fiche de l’agent en donne les raisons concrètes.'
            }
          >
            {agent.executable ? 'lançable' : 'non lançable'}
          </Badge>
        </div>
      </Link>
    </li>
  )
}

export default function AgentRosterScreen({ agents }: Readonly<{ agents: AvailableAgent[] }>) {
  const counts = countRoster(agents)
  const ranked = sortRoster(agents)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 xl:overflow-hidden">
      {/* Bandeau de comptage — dérivé de la MÊME liste que la table affiche. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge color="zinc">{counts.total} agent(s)</Badge>
        <Badge color="emerald" title="Chemin d’exécution complet ET version en service.">
          {counts.active} actif(s)
        </Badge>
        <Badge color="zinc">{counts.inactive} inactif(s)</Badge>
        <Badge color="red" title="Des outils déclarés ne résolvent vers aucun handler enregistré.">
          {counts.degraded} dégradé(s)
        </Badge>
        <Badge color="amber" title="Pas exécutable : agent retiré, ou une exigence dure manque.">
          {counts.unavailable} indisponible(s)
        </Badge>
        <Badge
          color="sky"
          title="Agents dont le dernier run a PROUVÉ le modèle exécuté. Les autres sont non prouvés — ce n’est pas la même chose que « faux »."
        >
          {counts.withProvenExecutedModel}/{counts.total} modèle prouvé
        </Badge>
      </div>

      <Panel
        title="Roster des agents"
        hint={`${ranked.length} au catalogue`}
        className="min-h-[20rem] min-w-0 xl:min-h-0 xl:flex-1"
        padded={false}
        bodyClassName="scroll-thin overflow-y-auto"
      >
        {ranked.length === 0 ? (
          <Unavailable
            reason="no-data"
            detail="Aucun agent n’est persisté dans le catalogue. La lecture a réussi — il n’y a réellement rien, ce n’est pas une panne."
          />
        ) : (
          <ul>
            {ranked.map((agent) => (
              <AgentRosterRow key={agent.copilotId} agent={agent} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
