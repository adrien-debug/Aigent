import AppShell from '@/components/app-shell'
import SurfaceState from '@/components/surface-state'

/**
 * Attente de la surface Qualification — le banc ET la fiche (ce fichier couvre
 * le segment `/qualification/**`, la route dynamique comprise).
 *
 * L'écran NOMME ce qu'il attend, parce que la lecture est réelle : catalogue,
 * gates, registres de qualification, preuves shadow/replay.
 *
 * Aucun squelette de valeurs : esquisser des checks ou des verdicts pendant la
 * lecture suggérerait un état qui n'a pas encore été lu — et sur cette surface,
 * un faux vert esquissé est exactement ce qui ferait promouvoir une version non
 * prouvée.
 */
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4 max-lg:pt-20">
        <div className="aig-panel flex h-full items-center justify-center">
          <SurfaceState kind="loading" detail="Lecture des preuves de qualification. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti." />
        </div>
      </div>
    </AppShell>
  )
}
