import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import ProjectDetailScreen from '@/components/projects/detail-screen'
import type { IntelligenceView, RepoView } from '@/components/projects/detail-screen'
import { buildRepoTree, deriveDeliveryCapability } from '@/components/projects/model'
import { getProject } from '@/lib/agent-mission-control/data'
import { getRepoTree } from '@/lib/agent-mission-control/github'
import { getProjectTeamGraph } from '@/lib/agent-mission-control/project-team/data'
import { isProjectId } from '@/lib/agent-mission-control/project-team/data'
import { loadRepoIntelligence } from '@/lib/agent-mission-control/repo-intelligence-store'
import type { ProjectTeamGraph } from '@/lib/agent-mission-control/project-team/types'

/**
 * Surface « /projects/[id] » — le détail d'un projet.
 *
 * LECTURE EN SERVER COMPONENT, JAMAIS PAR UNE ROUTE API. Les quatre sources
 * sont appelées directement (`getProject`, `getProjectTeamGraph`,
 * `loadRepoIntelligence`, `getRepoTree`), comme `src/app/page.tsx` appelle
 * `getDashboardOverview`. Un `fetch('/api/agent-ops/…')` depuis le serveur
 * serait un aller-retour HTTP vers soi-même qui devrait en plus repasser la
 * garde de `src/proxy.ts` ; une Server Action POSTerait vers la route de page,
 * hors du `matcher` du proxy — donc gardée par rien.
 *
 * CETTE PAGE EST EN LECTURE SEULE, STRICTEMENT
 * --------------------------------------------
 * `loadRepoIntelligence` et NON `ensureRepoIntelligence` : le second déclenche
 * un scan GitHub et PATCHe la ligne `projects`. Ouvrir un écran ne doit pas
 * écrire en base ni consommer du quota d'API. Aucune écriture GitHub n'est
 * appelée, pas même en dry-run.
 *
 * `/projects/[id]/builder` (PR 5) est un segment enfant : cette page occupe
 * `[id]` seul et ne le squatte pas.
 */
export const dynamic = 'force-dynamic'

/** Profondeur d'arbre affichée — une carte de structure, pas un explorateur. */
const TREE_DEPTH = 2

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  if (!isProjectId(id)) return { title: 'Aigent · Projet introuvable' }
  try {
    const project = await getProject(id)
    // Le titre ne fabrique pas un nom : un projet non lu reste « Projet ».
    return { title: project ? `Aigent · ${project.name}` : 'Aigent · Projet introuvable' }
  } catch {
    return { title: 'Aigent · Projet' }
  }
}

/**
 * Le graphe d'équipe.
 *
 * `getProjectTeamGraph` renvoie `undefined` quand le projet N'EXISTE PAS (même
 * convention que `getProject`) et LÈVE quand la lecture du projet ou des
 * copilotes échoue. Les deux mènent à un écran sans agent et disent pourtant
 * l'inverse l'un de l'autre : on les sépare ici.
 *  · `missing: true`  → 404.
 *  · `graph: null`    → lecture échouée, l'écran le DIT.
 */
async function loadGraph(
  id: string,
): Promise<{ graph: ProjectTeamGraph | null; missing: boolean }> {
  try {
    const graph = await getProjectTeamGraph(id)
    return graph === undefined ? { graph: null, missing: true } : { graph, missing: false }
  } catch {
    return { graph: null, missing: false }
  }
}

/**
 * L'arbre du dépôt lié.
 *
 * TROIS ÉTATS RÉELLEMENT DISTINGUABLES. `getRepoTree` LÈVE quand le jeton
 * manque, quand l'API est injoignable ou quand le dépôt est inaccessible — il
 * ne renvoie jamais `[]` en silence. Les `catch { return [] }` connus de
 * `github.ts:1382` (registre du chemin d'ÉCRITURE) et de
 * `consumer-bootstrap.ts:209` (code GÉNÉRÉ, exécuté dans le dépôt
 * consommateur) ne sont pas sur ce chemin. Un `[]` reçu ici est donc une vraie
 * mesure, et un échec est un vrai échec.
 *
 * RÉSERVE HONNÊTE, non levable depuis ce loader : GitHub tronque les très gros
 * arbres et `getRepoTree` ignore le drapeau `truncated` de la réponse
 * (`github.ts:453-461`). Un arbre tronqué est donc indiscernable d'un arbre
 * complet. L'écran ne peut pas le dire ; le bornage de profondeur qu'il annonce
 * (`+N plus profond`) ne couvre pas ce cas.
 */
async function loadRepo(repoFullName: string | undefined): Promise<RepoView> {
  if (!repoFullName) {
    return { state: 'unlinked', fullName: null, roots: [], deeperEntries: 0, failure: null }
  }
  try {
    const entries = await getRepoTree(repoFullName)
    const { roots, deeperEntries } = buildRepoTree(entries, TREE_DEPTH)
    return { state: 'read', fullName: repoFullName, roots, deeperEntries, failure: null }
  } catch (err) {
    return {
      state: 'unreadable',
      fullName: repoFullName,
      roots: [],
      deeperEntries: 0,
      failure: err instanceof Error ? err.message : 'lecture du dépôt impossible',
    }
  }
}

/**
 * L'intelligence de dépôt DÉJÀ EN CACHE. Jamais de scan : `loadRepoIntelligence`
 * ne fait qu'un SELECT. `intelligence: null` après une lecture réussie signifie
 * « jamais scanné » — un fait, distinct de `unreadable`.
 */
async function loadIntel(id: string): Promise<IntelligenceView> {
  try {
    const stored = await loadRepoIntelligence(id)
    return { intelligence: stored.intelligence, scannedAt: stored.scannedAt, unreadable: false }
  } catch {
    return { intelligence: null, scannedAt: null, unreadable: true }
  }
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  // Un id malformé n'est pas une erreur de backend : c'est une adresse qui
  // n'existe pas. On 404 sans interroger la base.
  if (!isProjectId(id)) notFound()

  const { graph, missing } = await loadGraph(id)
  if (missing) notFound()

  // Le nom vient du graphe quand il a été lu. Sinon on retente `getProject`
  // seul : le graphe peut avoir échoué sur les copilotes alors que la ligne
  // projet est lisible. Un nom introuvable reste l'id — jamais un nom inventé.
  //
  // `notFound()` LÈVE une exception que Next intercepte : elle ne doit donc
  // jamais partir d'un `try` local, qui l'avalerait et transformerait un 404 en
  // écran « lecture échouée ». Le `catch` ci-dessous ne couvre que l'appel.
  let project: Awaited<ReturnType<typeof getProject>>
  let projectReadFailed = false
  try {
    project = await getProject(id)
  } catch {
    // Ligne projet illisible : on garde ce que le graphe a pu donner.
    project = undefined
    projectReadFailed = true
  }

  // Le graphe a déjà prouvé l'existence du projet quand il a été lu ; on ne
  // 404 sur l'absence de ligne que si la lecture a RÉUSSI en ne trouvant rien.
  if (!projectReadFailed && project === undefined && graph === null) notFound()

  const name = graph?.project.name ?? project?.name ?? null
  const repoFullName = project?.repoFullName

  const [repo, intel] = await Promise.all([loadRepo(repoFullName), loadIntel(id)])

  return (
    <AppShell>
      <ProjectDetailScreen
        name={name ?? id}
        graph={graph}
        repo={repo}
        intel={intel}
        delivery={deriveDeliveryCapability(process.env)}
      />
    </AppShell>
  )
}
