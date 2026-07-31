import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

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
      <div className="h-full p-4">
        <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="flex items-center gap-3 px-6">
            <span
              aria-hidden="true"
              className="pulse-live size-1.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500"
            />
            <Text>Lecture de l’état du plan d’exécution…</Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
