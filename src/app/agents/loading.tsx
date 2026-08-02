import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import { SurfaceLoading } from '@/components/surface-shell'

/**
 * Attente de la surface Agents — roster ET fiche (ce fichier couvre le segment
 * `/agents/**`, la route dynamique comprise).
 *
 * Contrairement au `loading.tsx` racine, celui-ci peut NOMMER ce qu'il attend :
 * ces écrans lisent réellement le catalogue canonique et, sur une fiche, la gate
 * de release. Le libellé neutre de la racine existait parce que les neuf
 * surfaces de PR 1 ne lisaient rien ; ici la lecture est réelle.
 *
 * Aucun squelette de valeurs : esquisser des cartes chiffrées pendant la lecture
 * suggère un état qui n'a pas encore été lu. L'écran dit qu'il attend, rien de
 * plus.
 */
const ENTRY = navEntry('/agents')

export default function Loading() {
  return (
    <AppShell>
      <SurfaceLoading
        title={ENTRY.name}
        description={ENTRY.purpose}
        detail="Lecture du catalogue d’agents. Aucun chiffre n’est affiché tant que la lecture n’a pas abouti."
      />
    </AppShell>
  )
}
