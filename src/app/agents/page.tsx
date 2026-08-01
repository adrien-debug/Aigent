import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import AgentRosterScreen from '@/components/agents/roster-screen'
import SurfaceState from '@/components/surface-state'
import { navEntry } from '@/components/navigation'
import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'
import { resolveVisualizationsFor } from '@/components/visualizations/embed/registry'
import type { ResolvedVisualization } from '@/components/visualizations/embed/contract'

/**
 * Surface « /agents » — le roster, branché sur le contrat canonique.
 *
 * LECTURE EN SERVER COMPONENT, jamais via `/api/**`. La page appelle
 * `getAvailableAgents` directement, comme l'aperçu appelle `getDashboardOverview` :
 * une route API rajouterait un aller-retour HTTP, une seconde frontière d'auth et
 * une seconde occasion de diverger du contrat.
 *
 * DEUX ABSENCES, JAMAIS CONFONDUES. `getAvailableAgents` JETTE quand le backend
 * est injoignable, et rend `[]` quand la lecture a réussi sur un catalogue vide.
 * La première est un état « indisponible » (on ne sait pas), la seconde un état
 * « vide » (on sait qu'il n'y a rien). Les afficher pareil transformerait une
 * panne en produit sain.
 */
const ENTRY = navEntry('/agents')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// Le roster lit l'état vivant du catalogue : jamais de cache statique.
export const dynamic = 'force-dynamic'

async function loadRoster() {
  try {
    return {
      agents: await getAvailableAgents(),
      failure: null as string | null,
    }
  } catch (err) {
    return {
      agents: null,
      failure: err instanceof Error ? err.message : 'lecture impossible',
    }
  }
}

/**
 * Les panneaux de la fonction `agents` — accessoires, jamais porteurs.
 *
 * Leur échec de RÉSOLUTION ne doit pas emporter le roster : le catalogue est la
 * donnée de cette page, les graphiques l'illustrent. Une source Grafana muette
 * se dit d'elle-même dans son cadre (`NOT_CONFIGURED`, `UNAVAILABLE`) — ce
 * `catch` ne couvre que l'échec du résolveur lui-même.
 */
async function loadAgentVisualizations(): Promise<ResolvedVisualization[]> {
  try {
    return await resolveVisualizationsFor('agents')
  } catch {
    return []
  }
}

export default async function Page() {
  const [{ agents, failure }, visualizations] = await Promise.all([
    loadRoster(),
    loadAgentVisualizations(),
  ])

  // Backend muet : l'écran DIT qu'il ne sait pas. Il ne rend pas une liste vide,
  // qui se lirait comme « aucun agent » — l'inverse de la vérité.
  if (agents === null) {
    return (
      <AppShell>
        <div className="h-full p-4 max-lg:pt-20">
          <div className="aig-panel flex h-full items-center justify-center">
            {/* Le flux interrompu, pas le blueprint : la source EXISTE, c'est la
                lecture qui a échoué. Même geste que `/runs` sur la même nature
                d'échec — un opérateur reconnaît l'état sans relire le texte. */}
            <SurfaceState
              kind="unavailable"
              detail={
                failure
                  ? `Le catalogue d’agents n’a pas pu être lu — ${failure}. Aucune liste n’est affichée : une liste vide se lirait comme « aucun agent », ce qui n’est pas ce qui est su.`
                  : 'Le catalogue d’agents n’a pas pu être lu. Aucune liste n’est affichée — une liste vide se lirait comme « aucun agent », ce qui n’est pas ce qui est su.'
              }
            />
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <AgentRosterScreen agents={agents} visualizations={visualizations} />
    </AppShell>
  )
}
