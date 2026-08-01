import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

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
            <Text>Lecture du catalogue d’agents…</Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
