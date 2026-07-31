import AppShell from '@/components/app-shell'
import { Text } from '@/components/ui/text'

/**
 * État de CHARGEMENT de `/runs` — le quatrième état, distinct des trois autres.
 *
 * Il tient une place vide et le DIT. Aucune ossature de fausses tuiles avec des
 * chiffres gris : un squelette qui dessine six KPI laisse croire, une fraction
 * de seconde, que six mesures existent. Ici on n'affiche aucune forme qui
 * ressemble à une donnée.
 *
 * `dynamic = 'force-dynamic'` sur la page fait que cet écran est réellement vu
 * pendant la lecture PostgREST, qui n'est pas instantanée.
 */
export default function Loading() {
  return (
    <AppShell>
      <div className="h-full p-4">
        <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
          <div className="max-w-md px-6 text-center">
            <span className="rounded-md bg-zinc-950/5 px-2 py-0.5 text-xs font-medium text-zinc-500 uppercase dark:bg-white/5 dark:text-zinc-400">
              Lecture en cours
            </span>
            <Text className="mt-3">
              La fenêtre de runs des dernières 24 heures est en cours de lecture. Aucun chiffre
              n&apos;est affiché tant que la lecture n&apos;a pas abouti.
            </Text>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
