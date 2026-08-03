import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'
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
    return { items: buildProjectList(buildProjectOverview(projects, copilots)) }
  } catch (err) {
    // Détail réel au log serveur uniquement — un message de data layer nomme
    // la table et ses filtres. L'état rendu reste « indisponible ».
    console.error('[projects] lecture de la liste des projets impossible', err)
    return { items: null }
  }
}

export default async function Page() {
  const { items } = await loadProjects()

  if (items === null) {
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="La liste des projets n’a pas pu être lue. Aucun projet n’est affiché — ce n’est pas un catalogue vide, c’est un catalogue inconnu. Le détail technique est dans les logs du serveur."
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <ProjectsListScreen items={items} />
    </AppShell>
  )
}
