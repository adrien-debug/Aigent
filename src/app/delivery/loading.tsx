import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceLoading } from '@/components/surface-shell'

/**
 * Attente de la surface Livraison — banc ET fiche (ce fichier couvre le segment
 * `/delivery/**`, la route dynamique comprise).
 *
 * Aucun squelette de valeurs : esquisser des cartes chiffrées ou des voyants
 * pendant la lecture suggère un état qui n'a pas encore été lu. Sur cette
 * surface le risque est particulier — un voyant gris à côté de « livré »
 * pendant le chargement se lirait comme « jamais livré », c'est-à-dire une
 * affirmation. L'écran dit qu'il attend, rien de plus.
 */
const ENTRY = navEntry('/delivery')

export default function Loading() {
  return (
    <AppShell>
      <SurfaceLoading
        title={ENTRY.name}
        description={ENTRY.purpose}
        detail="Lecture des livraisons. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti."
      />
    </AppShell>
  )
}
