import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import DeliveryDetailScreen from '@/components/delivery/detail-screen'
import { loadDeliveryDetail } from '@/components/delivery/server-reads'
import { Unavailable } from '@/components/cockpit/primitives'
import { Text } from '@/components/ui/text'

/**
 * Fiche de livraison d'un agent — `/delivery/[copilotId]`, deep link réel.
 *
 * L'item de nav « Livraison » reste actif : `activeNavHref` retient le préfixe
 * le plus long, et `/delivery` préfixe `/delivery/<id>`.
 *
 * LECTURE EN SERVER COMPONENT. `loadDeliveryDetail` compose les résolveurs
 * existants (événement de livraison, scorecard, sandbox, provisioning
 * consommateur, télémétrie), chacun ISOLÉ : la panne de l'un dégrade SON panneau
 * et non la page. Aucune de ces lectures n'écrit ni ne déclenche d'action
 * distante.
 *
 * QUATRE ABSENCES DISTINCTES SUR CETTE ROUTE :
 *  · la lecture du copilot jette   → écran « indisponible » (on ne sait pas) ;
 *  · le copilot n'existe pas       → `notFound()`, un vrai 404 ;
 *  · une sous-lecture jette        → panneau « non lu », page vivante ;
 *  · la lecture réussit, rien lu   → panneau « aucune mesure », fait prouvé.
 *
 * `notFound()` est appelé HORS de tout `try/catch` : il fonctionne en LEVANT une
 * erreur spéciale que Next intercepte, et l'attraper la transformerait en 500.
 */
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ copilotId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { copilotId } = await params
  // Le titre ne doit pas faire tomber la page : si la lecture échoue, on titre
  // sobrement plutôt que de propager l'erreur depuis les métadonnées.
  try {
    const detail = await loadDeliveryDetail(copilotId)
    return { title: detail ? `Aigent · Livraison · ${detail.copilotName}` : 'Aigent · Agent inconnu' }
  } catch {
    return { title: 'Aigent · Livraison' }
  }
}

export default async function Page({ params }: PageProps) {
  const { copilotId } = await params

  let detail: Awaited<ReturnType<typeof loadDeliveryDetail>>
  try {
    detail = await loadDeliveryDetail(copilotId)
  } catch (err) {
    const failure = err instanceof Error ? err.message : 'lecture impossible'
    return (
      <AppShell>
        <div className="h-full p-4">
          <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="max-w-md px-6 text-center">
              <Unavailable
                reason="unread"
                detail="La fiche de livraison de cet agent n’a pas pu être lue. Ce n’est pas « agent inconnu » — c’est une lecture qui a échoué."
              />
              <Text className="mt-3">{failure}</Text>
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  // Lecture réussie, aucune ligne : l'agent n'existe VRAIMENT pas → 404 honnête.
  if (detail === undefined) notFound()

  return (
    <AppShell>
      <DeliveryDetailScreen detail={detail} />
    </AppShell>
  )
}
