import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import BuilderWorkspace from '@/components/builder/workspace'
import { getProject } from '@/lib/agent-mission-control/data'
import { getProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-conversation'
import type { ProjectBuilderConversationBundle } from '@/lib/agent-mission-control/project-builder-types'

/**
 * Surface « /builder/:projectId » — le poste d'authoring d'un projet.
 *
 * LECTURE ICI (RSC direct), MUTATIONS DANS LE CLIENT (vers `/api/agent-ops/**`).
 * Voir l'en-tête de `src/app/builder/page.tsx` pour le contrat complet.
 *
 * QUATRE ÉTATS, TENUS SÉPARÉMENT
 * ------------------------------
 *  · `not-found`   — le projet n'existe pas : `notFound()`, pas un écran vide.
 *  · `unavailable` — le backend live n'est pas configuré : on ne PEUT pas lire.
 *  · `error`       — la lecture a été tentée et a échoué.
 *  · `empty`       — la lecture a réussi ; un fil neuf est un vide PROUVÉ, et
 *                    c'est le cas normal d'un projet qu'on ouvre pour la
 *                    première fois (comme `agent_drafts`, vide en base).
 *
 * `getProjectBuilderConversationBundle` CRÉE la conversation si elle n'existe
 * pas — c'est pour ça que l'existence du projet est vérifiée AVANT, exactement
 * comme le fait la route `builder/conversation` : sans ce pré-contrôle, ouvrir
 * un id inconnu persisterait une conversation fantôme.
 */
export const dynamic = 'force-dynamic'

/** Même forme que le `PROJECT_ID_RE` des routes — un id hors forme n'existe pas. */
const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * Le backend live est-il configuré ? Mêmes conditions que `requireLiveBackend()`
 * des routes builder : sans elles, la lecture n'est pas « en échec », elle est
 * IMPOSSIBLE — deux états distincts que l'écran ne confond pas.
 */
function backendConfigured(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    Boolean(process.env.AMC_SUPABASE_URL) &&
    Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)
  )
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectId: string }>
}): Promise<Metadata> {
  const { projectId } = await params
  if (!PROJECT_ID_RE.test(projectId) || !backendConfigured()) {
    return { title: 'Aigent · Builder' }
  }
  try {
    const project = await getProject(projectId)
    return { title: project ? `Aigent · Builder · ${project.name}` : 'Aigent · Builder' }
  } catch {
    // Un titre n'est pas une raison de faire échouer la page.
    return { title: 'Aigent · Builder' }
  }
}

export default async function Page({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params

  // Un id malformé ne peut désigner aucun projet réel : 404 franc.
  if (!PROJECT_ID_RE.test(projectId)) notFound()

  // Backend absent : on ne tente RIEN et on le dit. Ce n'est pas un échec de
  // lecture, c'est une lecture impossible — et surtout pas un projet introuvable.
  if (!backendConfigured()) {
    return (
      <AppShell>
        <BuilderWorkspace
          projectId={projectId}
          projectName="Projet"
          repoFullName={null}
          bundle={null}
          unreadable
          failure={null}
          backendUnavailable
        />
      </AppShell>
    )
  }

  let bundle: ProjectBuilderConversationBundle | null = null
  let failure: string | null = null

  // La lecture du projet est isolée dans son propre `try` et ne contient AUCUN
  // `notFound()` : ce dernier fonctionne en levant une erreur de contrôle, qu'un
  // `catch` avalerait en « lecture échouée ». On distingue donc ici les deux
  // résultats — `undefined` (absence prouvée) et l'exception (lecture échouée) —
  // et on décide APRÈS le bloc.
  let project: Awaited<ReturnType<typeof getProject>>
  try {
    project = await getProject(projectId)
  } catch (err) {
    return (
      <AppShell>
        <BuilderWorkspace
          projectId={projectId}
          projectName="Projet"
          repoFullName={null}
          bundle={null}
          unreadable
          failure={err instanceof Error ? err.message : 'lecture impossible'}
          backendUnavailable={false}
        />
      </AppShell>
    )
  }

  // Lecture réussie ET aucun projet : une absence PROUVÉE → 404, jamais un
  // écran vide qui laisserait croire à un projet sans conversation.
  if (!project) notFound()

  const projectName = project.name
  const repoFullName = project.repoFullName ?? null

  try {
    bundle = await getProjectBuilderConversationBundle(projectId)
  } catch (err) {
    failure = err instanceof Error ? err.message : 'lecture impossible'
  }

  return (
    <AppShell>
      <BuilderWorkspace
        projectId={projectId}
        projectName={projectName}
        repoFullName={repoFullName}
        bundle={bundle}
        unreadable={bundle === null}
        failure={failure}
        backendUnavailable={false}
      />
    </AppShell>
  )
}
