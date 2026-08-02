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
    return {
      nowMs,
      overview: await getDashboardOverview(nowMs),
      failure: null as string | null,
    }
  } catch (err) {
    return {
      nowMs,
      overview: null,
      failure: err instanceof Error ? err.message : 'lecture impossible',
    }
  }
}

export default async function HomePage() {
  const { nowMs, overview, failure } = await loadCockpit()

  if (overview === null) {
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail={`Le backend n'a pas répondu. Aucun chiffre n'est affiché — un tableau qui invente des valeurs est plus dangereux qu'un tableau vide.${failure ? ` (${failure})` : ''}`}
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
