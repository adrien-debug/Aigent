import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import AgentDetailScreen from '@/components/agents/detail-screen'
import SurfaceState from '@/components/surface-state'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'
import { getLatestQualificationRun } from '@/lib/agent-mission-control/qualification-orchestrator'
import { evaluateReleaseGate } from '@/lib/agent-mission-control/release-gate'

/**
 * Fiche d'un agent — `/agents/[copilotId]`, deep link réel.
 *
 * L'item de nav « Agents » reste actif : `activeNavHref` retient le préfixe le
 * plus long, et `/agents` préfixe `/agents/<id>`.
 *
 * LECTURE EN SERVER COMPONENT. `getAgentDetail` est le résolveur UNIQUE de
 * toutes les sections : une seule dérivation, donc l'en-tête ne peut pas
 * afficher un statut vert pendant que le panneau d'exécutabilité dit l'inverse.
 * La gate de release et le registre de qualification sont deux lectures de plus,
 * chacune ISOLÉE : leur panne dégrade LEUR panneau, pas la page entière — c'est
 * la même posture que le résolveur applique déjà à la télémétrie.
 *
 * QUATRE ABSENCES DISTINCTES SUR CETTE ROUTE :
 *  · la lecture jette              → écran « indisponible » (on ne sait pas) ;
 *  · le copilot n'existe pas       → `notFound()`, un vrai 404 ;
 *  · une sous-lecture jette        → panneau « indisponible », page vivante ;
 *  · la lecture réussit, rien lu   → panneau « aucune mesure ».
 */
export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ copilotId: string }> }

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { copilotId } = await params
  // Le titre ne doit pas faire tomber la page : si la lecture échoue, on titre
  // sobrement plutôt que de propager l'erreur depuis les métadonnées.
  try {
    const detail = await getAgentDetail(copilotId)
    return {
      title: detail ? `Aigent · ${detail.copilot.name}` : 'Aigent · Agent inconnu',
    }
  } catch {
    return { title: 'Aigent · Agent' }
  }
}

export default async function Page({ params }: PageProps) {
  const { copilotId } = await params

  let detail: Awaited<ReturnType<typeof getAgentDetail>>
  try {
    detail = await getAgentDetail(copilotId)
  } catch (err) {
    const failure = err instanceof Error ? err.message : 'lecture impossible'
    return (
      <AppShell>
        <div className="h-full p-4 max-lg:pt-20">
          <div className="aig-panel flex h-full items-center justify-center">
            {/* Le flux interrompu : la source EXISTE, c'est la lecture qui
                a echoue. Meme geste sur toutes les surfaces — un operateur
                reconnait l'etat sans relire le texte. */}
            <SurfaceState
              kind="unavailable"
              detail={`La fiche de cet agent n’a pas pu être lue. Ce n’est pas « agent inconnu » — c’est une lecture qui a échoué.${failure ? ` (${failure})` : ''}`}
            />
          </div>
        </div>
      </AppShell>
    )
  }

  // Lecture réussie, aucune ligne : l'agent n'existe VRAIMENT pas → 404 honnête.
  if (detail === undefined) notFound()

  // La version candidate est celle que le résolveur a déjà retenue — on ne
  // réinvente pas la règle `production_version_id ?? latest_version_id`.
  const candidateVersionId = detail.currentVersion?.id

  const [gateResult, qualificationResult] = await Promise.all([
    (async () => {
      try {
        const gate = await evaluateReleaseGate(copilotId, candidateVersionId)
        return { gate, failure: null as string | null }
      } catch (err) {
        return {
          gate: null,
          failure: err instanceof Error ? err.message : 'évaluation impossible',
        }
      }
    })(),
    (async () => {
      if (!candidateVersionId) return { run: null, failure: null as string | null }
      try {
        const run = await getLatestQualificationRun(copilotId, candidateVersionId)
        return { run, failure: null as string | null }
      } catch (err) {
        return {
          run: null,
          failure: err instanceof Error ? err.message : 'lecture impossible',
        }
      }
    })(),
  ])

  return (
    <AppShell>
      <AgentDetailScreen
        detail={detail}
        gate={gateResult.gate}
        gateFailure={gateResult.failure}
        qualification={qualificationResult.run}
        qualificationFailure={qualificationResult.failure}
      />
    </AppShell>
  )
}
