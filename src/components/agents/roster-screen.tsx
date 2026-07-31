/**
 * Roster des agents — page liste éditoriale, disclosure progressive.
 *
 * Server Component : il reçoit le contrat canonique déjà lu et le distribue. Il
 * ne lit rien lui-même et ne recalcule aucun statut — `AvailableAgent.status`
 * est la même dérivation que la garde d'exécution, et la recalculer ici est
 * exactement comme un écran a fini par promettre un lancement que l'API
 * refusait.
 *
 * La ligne de liste ne montre que le nécessaire : nom, état principal,
 * dernière activité et signal critique éventuel. Le détail complet vit au clic.
 */
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Heading, Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import type { AvailableAgent } from '@/lib/agent-mission-control/available-agents'
import { Rail, SEVERITY, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { RuntimeStatusBadge } from './atoms'
import { countRoster, isUnavailable, sortRoster, unresolvedToolsBadgeText } from './roster-model'

/** Le rail reprend la gravité du statut runtime — la même que le badge. */
const RAIL_COLOR: Record<AvailableAgent['status'], string> = {
  active: SEVERITY.good,
  inactive: SEVERITY.muted,
  degraded: SEVERITY.bad,
  unavailable: SEVERITY.warn,
}

function isoShort(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().slice(0, 16).replace('T', ' ')
}

function missingRequirement(agent: AvailableAgent): string | null {
  if (isUnavailable(agent, 'version')) return 'Version non resolue'
  if (isUnavailable(agent, 'provider')) return 'Provider non resolu'
  if (isUnavailable(agent, 'configuredModel')) return 'Modele non resolu'
  if (isUnavailable(agent, 'runtime')) return 'Runtime non resolu'
  if (isUnavailable(agent, 'projectId')) return 'Projet non resolu'
  return null
}

function criticalSignal(agent: AvailableAgent): { tone: 'amber' | 'red'; text: string } | null {
  if (agent.unresolvedToolIds.length > 0) {
    return { tone: 'red', text: unresolvedToolsBadgeText(agent.unresolvedToolIds.length) }
  }
  if (agent.runtimeProvisioned === false) {
    return { tone: 'amber', text: 'Assistant LangGraph non provisionne' }
  }
  const missing = missingRequirement(agent)
  if (missing) {
    return { tone: 'amber', text: missing }
  }
  return null
}

function rosterSummary(agents: readonly AvailableAgent[]): string {
  const counts = countRoster(agents)
  const bits = [
    `${counts.total} agent${counts.total > 1 ? 's' : ''} au catalogue`,
    `${counts.active} actif${counts.active > 1 ? 's' : ''}`,
  ]
  if (counts.degraded > 0) bits.push(`${counts.degraded} degrade${counts.degraded > 1 ? 's' : ''}`)
  if (counts.withUnresolvedTools > 0) bits.push(`${counts.withUnresolvedTools} avec outil non resolu`)
  return bits.join(' · ')
}

function AgentRosterRow({ agent }: Readonly<{ agent: AvailableAgent }>) {
  const activity = isoShort(agent.lastRunAt)
  const signal = criticalSignal(agent)

  return (
    <li className="relative">
      <Rail color={RAIL_COLOR[agent.status]} />
      <Link
        href={`/agents/${agent.copilotId}`}
        className="group flex items-start gap-4 px-5 py-4 transition hover:bg-zinc-950/2.5 focus-visible:bg-zinc-950/2.5"
      >
        <Avatar
          square
          initials={initialsOf(agent.name)}
          className="size-10 shrink-0 bg-zinc-950/3 text-zinc-700 outline-zinc-950/10"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Strong className="truncate">{agent.name}</Strong>
            <RuntimeStatusBadge status={agent.status} />
          </div>
          <Text className="mt-1 truncate">
            {activity ? `Dernier run : ${activity} UTC` : 'Aucune activite enregistree'}
          </Text>
          {signal ? (
            <Text className={signal.tone === 'red' ? 'mt-1 text-red-600' : 'mt-1 text-amber-700'}>
              {signal.text}
            </Text>
          ) : null}
        </div>

        <Text className="hidden shrink-0 text-sm text-zinc-400 transition group-hover:text-zinc-600 sm:block">
          Ouvrir
        </Text>
      </Link>
    </li>
  )
}

export default function AgentRosterScreen({ agents }: Readonly<{ agents: AvailableAgent[] }>) {
  const ranked = sortRoster(agents)

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6 pt-16 lg:pt-8">
      <header className="flex flex-col gap-4 border-b border-zinc-950/6 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-3xl">
          <Text className="text-sm font-medium text-zinc-500">Agents</Text>
          <Heading level={1} className="mt-2">
            Agents
          </Heading>
          <Text className="mt-3 text-base/7 text-zinc-600">
            {rosterSummary(ranked)}. La liste montre l essentiel pour decider quoi ouvrir, pas
            tout ce que le contrat sait.
          </Text>
        </div>

        <Button color="dark/zinc" href="/builder">
          Nouveau copilot
        </Button>
      </header>

      <section className="rounded-2xl border border-zinc-950/6 bg-white shadow-sm">
        <div className="border-b border-zinc-950/6 px-5 py-4">
          <Subheading level={2}>Liste des agents</Subheading>
          <Text className="mt-1">
            Nom, etat principal, derniere activite et signal critique eventuel. Le reste vient au
            clic.
          </Text>
        </div>

        {ranked.length === 0 ? (
          <div className="px-5 py-10">
            <Unavailable
              reason="no-data"
              detail="Aucun agent n'est persiste dans le catalogue. La lecture a reussi — il n'y a reellement rien, ce n'est pas une panne."
            />
          </div>
        ) : (
          <ul className="divide-y divide-zinc-950/6">
            {ranked.map((agent) => (
              <AgentRosterRow key={agent.copilotId} agent={agent} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
