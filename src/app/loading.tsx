import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

/**
 * L'aperçu lit six sources PostgREST avant de rendre quoi que ce soit. Sans ce
 * fichier, Next garde l'écran précédent (ou le blanc) pendant toute la lecture,
 * et l'opérateur ne sait pas si le système réfléchit ou s'il est mort.
 *
 * L'attente ne montre PAS de faux chiffres ni de squelette de valeurs : un
 * écran qui esquisse des cartes vides pendant deux secondes suggère un état
 * qu'il n'a pas encore lu. Il dit seulement qu'il attend.
 *
 * Ce fichier est HÉRITÉ par les neuf surfaces créées en PR 1, dont aucune ne lit
 * quoi que ce soit. Le libellé est donc volontairement neutre : « Lecture de
 * l'état de la flotte » serait faux sur `/settings`, qui ne lit rien du tout et
 * ne traverse cet état que le temps d'un rendu. Quand une surface acquerra sa
 * propre lecture, elle apportera son propre `loading.tsx` qui pourra la nommer.
 */
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4">
        <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-3 px-6">
            <span
              aria-hidden="true"
              className="pulse-live size-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500"
            />
            <Text>Chargement de la surface…</Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
