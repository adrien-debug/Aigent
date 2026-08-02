import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceLoading } from '@/components/surface-shell'

/**
 * Attente de la surface Runtime.
 *
 * Cet écran lit réellement — télémétrie, Agent Server, catalogue, GitHub selon
 * l'onglet — donc il peut nommer son attente. Aucun squelette de valeurs :
 * esquisser des tuiles chiffrées pendant la lecture suggère un état qui n'a pas
 * encore été lu, et sur une surface qui décrit ce qui est câblé ou non, ce faux
 * aperçu serait précisément le mensonge à éviter.
 */
const ENTRY = navEntry('/runtime')

export default function Loading() {
  return (
    <AppShell>
      <SurfaceLoading
        title={ENTRY.name}
        description={ENTRY.purpose}
        detail="Lecture de l’état du plan d’exécution. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti."
      />
    </AppShell>
  )
}
