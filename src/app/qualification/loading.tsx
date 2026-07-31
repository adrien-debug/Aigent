import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

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
      <div className="h-full p-4">
        <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-3 px-6">
            <span
              aria-hidden="true"
              className="pulse-live size-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500"
            />
            <Text>Lecture des preuves de qualification…</Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
