import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import DeliveryDetailScreen from '@/components/delivery/detail-screen'
import { loadDeliveryDetail } from '@/components/delivery/server-reads'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'

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
const ENTRY = navEntry('/delivery')

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ copilotId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { copilotId } = await params
  // Le titre ne doit pas faire tomber la page : si la lecture échoue, on titre
  // sobrement plutôt que de propager l'erreur depuis les métadonnées.
  try {
    const detail = await loadDeliveryDetail(copilotId)
    return {
      title: detail ? `Aigent · Livraison · ${detail.copilotName}` : 'Aigent · Agent inconnu',
    }
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
    // Détail réel au log serveur uniquement — jamais dans le HTML.
    console.error('[delivery] lecture de la fiche de livraison impossible', copilotId, err)
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="La fiche de livraison de cet agent n’a pas pu être lue. Ce n’est pas « agent inconnu » — c’est une lecture qui a échoué. Le détail technique est dans les logs du serveur."
        />
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
