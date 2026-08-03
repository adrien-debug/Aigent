import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'
import BuilderSelectScreen from '@/components/builder/select-screen'
import { buildProjectChoices } from '@/components/builder/model'
import { getProjects } from '@/lib/agent-mission-control/data'

/**
 * Surface « /builder » — sélection du projet, BRANCHÉE sur l'état vivant.
 *
 * LECTURE EN SERVER COMPONENT, JAMAIS PAR UNE ROUTE API
 * -----------------------------------------------------
 * Cette page appelle directement `getProjects`, comme `src/app/page.tsx` appelle
 * `getDashboardOverview`. Pas de `fetch('/api/…')` : ce serait un aller-retour
 * HTTP du serveur vers lui-même, qui devrait en plus se réauthentifier auprès de
 * `src/proxy.ts`. Pas de Server Action non plus — elle POSTe vers la route de la
 * page, hors du `matcher` de `src/proxy.ts`, donc gardée par rien.
 *
 * Les MUTATIONS, elles, partent des composants client vers `/api/agent-ops/**`,
 * la seule surface que `src/proxy.ts` garde.
 *
 * `getProjects` LÈVE en cas d'échec (pas de repli). On capture pour distinguer
 * « lecture échouée » de « catalogue vide » : les deux rendraient une liste sans
 * ligne, et ce sont deux affirmations opposées.
 */
const ENTRY = navEntry('/builder')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// L'authoring lit l'état vivant : jamais de cache statique.
export const dynamic = 'force-dynamic'

async function loadProjects() {
  try {
    return { items: buildProjectChoices(await getProjects()) }
  } catch (err) {
    // Détail réel au log serveur uniquement — jamais dans le HTML.
    console.error('[builder] lecture de la liste des projets impossible', err)
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
          detail="La liste des projets n’a pas pu être lue. Ce n’est pas un catalogue vide, c’est un catalogue inconnu. Le détail technique est dans les logs du serveur."
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <BuilderSelectScreen items={items} />
    </AppShell>
  )
}
