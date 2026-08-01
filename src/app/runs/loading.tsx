import AppShell from '@/components/app-shell'
import SurfaceState from '@/components/surface-state'

/**
 * État de CHARGEMENT de `/runs` — le quatrième état, distinct des trois autres.
 *
 * Il tient une place vide et le DIT. Aucune ossature de fausses tuiles avec des
 * chiffres gris : un squelette qui dessine six KPI laisse croire, une fraction
 * de seconde, que six mesures existent. Les trois bandes de `SurfaceState` sont
 * de largeurs fixes et ne ressemblent à aucune donnée — elles disent « ça
 * arrive », pas « voici à quoi ça ressemblera ».
 *
 * `dynamic = 'force-dynamic'` sur la page fait que cet écran est réellement vu
 * pendant la lecture PostgREST, qui n'est pas instantanée.
 */
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4 max-lg:pt-20">
        <div className="aig-panel flex h-full items-center justify-center">
          <SurfaceState
            kind="loading"
            detail="La fenêtre de runs des dernières 24 heures est en cours de lecture. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti."
          />
        </div>
      </div>
    </AppShell>
  )
}
