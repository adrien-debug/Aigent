import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import ProjectsListScreen from '@/components/projects/list-screen'
import { buildProjectList } from '@/components/projects/model'
import { buildProjectOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'

/**
 * Surface « /projects » — la liste, BRANCHÉE sur l'état vivant.
 *
 * LECTURE EN SERVER COMPONENT, JAMAIS PAR UNE ROUTE API
 * ----------------------------------------------------
 * Cette page appelle directement `getProjects` / `getCopilots`, comme
 * `src/app/page.tsx` appelle `getDashboardOverview`. Pas de `fetch('/api/…')` :
 * ce serait un aller-retour HTTP inutile depuis le serveur vers lui-même, qui
 * devrait en plus se réauthentifier auprès de `src/proxy.ts`. Pas de Server
 * Action non plus : elle POSTe vers la route de la page, qui est hors du
 * `matcher` de `src/proxy.ts` — donc gardée par rien.
 *
 * POURQUOI PAS `getDashboardOverview()`
 * -------------------------------------
 * Il déclenche une vague de six lectures PostgREST (runs de la fenêtre, santé
 * du canal de télémétrie, livraisons récentes, approbations en attente…) dont
 * cette liste n'utilise RIEN. On lit les deux sources dont on a besoin et on
 * applique `buildProjectOverview`, la fonction PURE que l'aperçu utilise déjà
 * sur les mêmes entrées — les deux écrans ne peuvent donc pas diverger sur le
 * compte, le coût ou le taux de réussite d'un projet.
 *
 * `getProjects` et `getCopilots` LÈVENT en cas d'échec (pas de repli). On
 * capture pour distinguer « lecture échouée » de « catalogue vide » : les deux
 * rendraient une liste sans ligne, et ce sont deux affirmations opposées.
 */
const ENTRY = navEntry('/projects')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// Le catalogue lit l'état vivant : jamais de cache statique.
export const dynamic = 'force-dynamic'

async function loadProjects() {
  try {
    // En parallèle : les deux lectures sont indépendantes.
    const [projects, copilots] = await Promise.all([getProjects(), getCopilots()])
    return { items: buildProjectList(buildProjectOverview(projects, copilots)), failure: null }
  } catch (err) {
    return { items: null, failure: err instanceof Error ? err.message : 'lecture impossible' }
  }
}

export default async function Page() {
  const { items, failure } = await loadProjects()

  return (
    <AppShell>
      <ProjectsListScreen items={items ?? []} unreadable={items === null} failure={failure} />
    </AppShell>
  )
}
