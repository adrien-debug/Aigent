import AppShell from '@/components/app-shell'
import CockpitOverview from '@/components/cockpit/overview'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

const ENTRY = navEntry('/')

// Le cockpit lit l'état vivant de la flotte : jamais de cache statique.
export const dynamic = 'force-dynamic'

/**
 * L'instant est capturé HORS du rendu : `Date.now()` appelé pendant le rendu est
 * impur (react-hooks/purity) et rendrait le composant non idempotent. Le même
 * instant sert à la lecture et aux séries, pour que KPI et graphes décrivent
 * exactement la même fenêtre.
 */
async function loadCockpit() {
  const nowMs = Date.now()
  try {
    return { nowMs, overview: await getDashboardOverview(nowMs) }
  } catch (err) {
    // Le détail réel va au LOG SERVEUR, jamais au HTML. Le message d'une
    // erreur de data layer porte l'URL PostgREST, la table interrogée, ses
    // filtres, parfois la liste des variables d'environnement attendues :
    // rendu dans la page, c'est une carte du backend offerte à qui la lit.
    // L'ÉTAT rendu ne change pas pour autant — « indisponible » reste
    // « indisponible » (DESIGN_DOCTRINE §6) ; seul le texte technique part.
    console.error('[cockpit] lecture du tableau de bord impossible', err)
    return { nowMs, overview: null }
  }
}

export default async function HomePage() {
  const { nowMs, overview } = await loadCockpit()

  if (overview === null) {
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="Le backend n'a pas répondu. Aucun chiffre n'est affiché — un tableau qui invente des valeurs est plus dangereux qu'un tableau vide. Le détail technique est dans les logs du serveur."
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <CockpitOverview overview={overview} nowMs={nowMs} />
    </AppShell>
  )
}
