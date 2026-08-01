import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

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
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4">
        <div className="aig-panel flex h-full items-center justify-center">
          <div className="flex items-center gap-3 px-6">
            <span
              aria-hidden="true"
              className="pulse-live aig-text-faint size-1.5 shrink-0 rounded-full bg-current"
            />
            <Text>Lecture des livraisons…</Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
