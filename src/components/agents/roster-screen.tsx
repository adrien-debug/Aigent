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
import { PageBody, PageHeader } from '@/components/app-shell'
import EmbeddedVisualization from '@/components/visualizations/embedded-visualization'
import type { ResolvedVisualization } from '@/components/visualizations/embed/contract'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Subheading } from '@/components/ui/heading'
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
  if (isUnavailable(agent, 'version')) return 'Version non résolue'
  if (isUnavailable(agent, 'provider')) return 'Provider non résolu'
  if (isUnavailable(agent, 'configuredModel')) return 'Modèle non résolu'
  if (isUnavailable(agent, 'runtime')) return 'Runtime non résolu'
  if (isUnavailable(agent, 'projectId')) return 'Projet non résolu'
  return null
}

function criticalSignal(agent: AvailableAgent): { tone: 'amber' | 'red'; text: string } | null {
  if (agent.unresolvedToolIds.length > 0) {
    return {
      tone: 'red',
      text: unresolvedToolsBadgeText(agent.unresolvedToolIds.length),
    }
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
  if (counts.degraded > 0) bits.push(`${counts.degraded} dégradé${counts.degraded > 1 ? 's' : ''}`)
  if (counts.withUnresolvedTools > 0) {
    bits.push(`${counts.withUnresolvedTools} avec outil non résolu`)
  }
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
        className="group flex items-start gap-4 px-5 py-4 transition hover:bg-white/4 focus-visible:bg-white/4"
      >
        {/* L'avatar était peint pour un fond blanc (`bg-zinc-950/3`,
            `text-zinc-700`) : sur le graphite il disparaissait. `aig-raised`
            le pose au palier au-dessus du panneau — la même mécanique que le
            rail de navigation, donc une seule règle à retenir. */}
        <Avatar
          square
          initials={initialsOf(agent.name)}
          className="aig-raised size-10 shrink-0 outline-0"
        />

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Strong className="truncate">{agent.name}</Strong>
            <RuntimeStatusBadge status={agent.status} />
          </div>
          <Text className="mt-1 truncate">
            {activity ? `Dernier run : ${activity} UTC` : 'Aucune activité enregistrée'}
          </Text>
          {/* Teintes remontées d'un cran (600/700 → 400) : sur graphite, un
              rouge 600 passe sous le seuil de lisibilité alors qu'il était
              calibré pour un fond blanc. La SÉVÉRITÉ n'a pas changé. */}
          {signal ? (
            <Text className={signal.tone === 'red' ? 'mt-1 text-red-400' : 'mt-1 text-amber-400'}>
              {signal.text}
            </Text>
          ) : null}
        </div>

        {/* L'affordance d'ouverture s'éclaire au survol : `aig-text-faint` au
            repos, accent au survol — le seul accent du produit. */}
        <Text className="aig-text-faint hidden shrink-0 text-sm transition group-hover:text-[var(--aig-accent)] sm:block">
          Ouvrir
        </Text>
      </Link>
    </li>
  )
}

export default function AgentRosterScreen({
  agents,
  visualizations = [],
}: Readonly<{
  agents: AvailableAgent[]
  /**
   * Panneaux de la fonction `agents`, déjà résolus côté serveur.
   *
   * Ce sont les SEULS panneaux qui ont leur place ici : « runs par agent » et
   * « couples projet/agent » répondent à la question de cette page. Le volume
   * global ou la latence p95 vivent sur `/runs`, qui parle d'exécutions. Un
   * écran qui montrerait les huit panneaux du registre ne serait plus un
   * roster, ce serait un second dashboard.
   */
  visualizations?: readonly ResolvedVisualization[]
}>) {
  const ranked = sortRoster(agents)

  return (
    <>
      {/* L'en-tête n'est plus recomposé ici : `PageHeader` porte le titre, la
          description, les actions, la gouttière mobile et le sticky pour les
          onze surfaces. Un écran qui redessine son propre en-tête est
          exactement la dérive que cette mission ferme. */}
      <PageHeader
        title="Agents"
        description={`${rosterSummary(ranked)}. La liste montre l’essentiel pour décider quoi ouvrir, pas tout ce que le contrat sait.`}
        actions={
          <Button color="dark/zinc" href="/builder">
            Nouveau copilot
          </Button>
        }
      />

      <PageBody>
        {visualizations.length > 0 ? (
          <section
            className="viz-scope grid gap-3 md:grid-cols-2 [&>*]:min-w-0"
            aria-label="Répartition par agent"
          >
            {visualizations.map((viz) => (
              <EmbeddedVisualization key={viz.id} visualization={viz} density="compact" />
            ))}
          </section>
        ) : null}

        <section className="aig-panel">
          <div className="aig-line-soft border-b px-5 py-4">
            <Subheading level={2}>Liste des agents</Subheading>
            <Text className="mt-1">
              Nom, état principal, dernière activité et signal critique éventuel. Le reste vient au
              clic.
            </Text>
          </div>

          {ranked.length === 0 ? (
            <div className="px-5 py-10">
              <Unavailable
                reason="no-data"
                detail="Aucun agent n'est persisté dans le catalogue. La lecture a réussi — il n'y a réellement rien, ce n'est pas une panne."
              />
            </div>
          ) : (
            <ul className="divide-y divide-white/6">
              {ranked.map((agent) => (
                <AgentRosterRow key={agent.copilotId} agent={agent} />
              ))}
            </ul>
          )}
        </section>
      </PageBody>
    </>
  )
}
