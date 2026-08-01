import AppShell from '@/components/app-shell'
import SurfaceState from '@/components/surface-state'

/**
 * Attente de la surface Runtime.
 *
 * Cet écran lit réellement — télémétrie, Agent Server, catalogue, GitHub selon
 * l'onglet — donc il peut nommer son attente. Aucun squelette de valeurs :
 * esquisser des tuiles chiffrées pendant la lecture suggère un état qui n'a pas
 * encore été lu, et sur une surface qui décrit ce qui est câblé ou non, ce faux
 * aperçu serait précisément le mensonge à éviter.
 */
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4 max-lg:pt-20">
        <div className="aig-panel flex h-full items-center justify-center">
          <SurfaceState kind="loading" detail="Lecture de l’état du plan d’exécution. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti." />
        </div>
      </div>
    </AppShell>
  )
}
