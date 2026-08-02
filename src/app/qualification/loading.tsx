import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceLoading } from '@/components/surface-shell'

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
const ENTRY = navEntry('/qualification')

export default function Loading() {
  return (
    <AppShell>
      <SurfaceLoading
        title={ENTRY.name}
        description={ENTRY.purpose}
        detail="Lecture des preuves de qualification. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti."
      />
    </AppShell>
  )
}
