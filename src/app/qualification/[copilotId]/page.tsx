import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import QualificationCockpitScreen from '@/components/qualification/cockpit-screen'
import { loadQualificationDetail } from '@/components/qualification/server-reads'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'

/**
 * Fiche de qualification — `/qualification/[copilotId]`, deep link réel.
 *
 * L'item de nav « Qualification » reste actif : `activeNavHref` retient le
 * préfixe le plus long, et `/qualification` préfixe `/qualification/<id>`.
 *
 * QUATRE ABSENCES DISTINCTES SUR CETTE ROUTE :
 *  · la lecture du copilot jette   → écran « indisponible » (on ne sait pas) ;
 *  · le copilot n'existe pas       → `notFound()`, un vrai 404 ;
 *  · une sous-lecture jette        → panneau « indisponible », page vivante ;
 *  · la lecture réussit, rien lu   → panneau « aucune mesure », un vide PROUVÉ.
 *
 * Les deux dernières comptent particulièrement ici : `qualification_runs` et
 * `improvement_proposals` sont réellement vides en base. Rendre ce vide comme
 * une panne — ou l'inverse — serait le mensonge le plus facile de cet écran.
 */
const ENTRY = navEntry('/qualification')

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ copilotId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { copilotId } = await params
  // Le titre ne doit pas faire tomber la page : sur échec on titre sobrement
  // plutôt que de propager l'erreur depuis les métadonnées.
  try {
    const detail = await loadQualificationDetail(copilotId)
    return {
      title: detail ? `Aigent · Qualification · ${detail.copilotName}` : 'Aigent · Agent inconnu',
    }
  } catch {
    return { title: 'Aigent · Qualification' }
  }
}

export default async function Page({ params }: PageProps) {
  const { copilotId } = await params

  let detail: Awaited<ReturnType<typeof loadQualificationDetail>>
  try {
    detail = await loadQualificationDetail(copilotId)
  } catch (err) {
    // Détail réel au log serveur uniquement — jamais dans le HTML.
    console.error('[qualification] lecture de la fiche de qualification impossible', copilotId, err)
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="La fiche de qualification n’a pas pu être lue. Ce n’est pas « agent inconnu » — c’est une lecture qui a échoué. Le détail technique est dans les logs du serveur."
        />
      </AppShell>
    )
  }

  // Lecture réussie, aucune ligne : le copilot n'existe VRAIMENT pas → 404.
  if (detail === undefined) notFound()

  return (
    <AppShell>
      <QualificationCockpitScreen detail={detail} />
    </AppShell>
  )
}
