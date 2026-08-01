import AppShell from '@/components/app-shell'
import CockpitOverview from '@/components/cockpit/overview-screen'
import SurfaceState from '@/components/surface-state'
import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

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
        {/* Le fond sombre codé en dur qui vivait ici n'a plus de raison d'être :
            le document EST graphite et `aig-panel` porte le fond, le liseré et le
            rayon en un seul rôle, identique aux dix autres surfaces. */}
        <div className="h-full p-4 max-lg:pt-20">
          <div className="aig-panel flex h-full items-center justify-center">
            {/* Le flux interrompu : la source EXISTE, c'est la lecture qui
                a echoue. Meme geste sur toutes les surfaces — un operateur
                reconnait l'etat sans relire le texte. */}
            <SurfaceState
              kind="unavailable"
              detail={`Le backend n'a pas répondu. Aucun chiffre n'est affiché — un tableau qui invente des valeurs est plus dangereux qu'un tableau vide.${failure ? ` (${failure})` : ''}`}
            />
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <CockpitOverview overview={overview} nowMs={nowMs} />
    </AppShell>
  )
}
