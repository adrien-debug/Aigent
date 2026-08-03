import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import RunsScreen from '@/components/runs/runs-screen'
import { countProvenance } from '@/components/runs/run-view-model'
import type { ProvenanceBreakdown } from '@/components/runs/run-view-model'
import { navEntry } from '@/components/navigation'
import { SurfaceUnavailable } from '@/components/surface-shell'
import { listRecentRuntimeTelemetryEvents } from '@/lib/agent-mission-control/runtime-telemetry-store'
import { deriveRunsMetrics } from '@/lib/runs-console/runs-metrics'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'
import {
  applyRunsFilters,
  buildRunsHref,
  hasActiveFilters,
  parseRunsFilters,
} from '@/lib/runs-console/runs-filters'

/**
 * Surface « /runs » — historique des exécutions, en maître-détail.
 *
 * LECTURE : Server Component appelant DIRECTEMENT le data layer. Pas de `fetch`
 * vers `/api/**`, pas de Server Action. Une Server Action POSTe vers la route de
 * la page, donc hors du `matcher` de `src/proxy.ts` — ce serait une quatrième
 * frontière de confiance, non gardée, ouverte par accident pour de la LECTURE.
 * Le contrat de cet écran est identique à celui de `src/app/page.tsx`.
 *
 * LECTURE SEULE : aucune mutation n'est offerte (ni resume, ni re-run). Un
 * bouton présent mais inerte serait un mensonge d'affordance ; il n'y en a pas.
 *
 * DEEP LINK : `/runs?run=<id>` plutôt que `/runs/[runId]`.
 * Trois raisons, toutes structurelles :
 *  1. Le maître-détail garde la LISTE à l'écran. Une route dynamique impliquerait
 *     soit de relire la fenêtre entière à chaque sélection, soit un layout
 *     partagé — pour un état qui n'est qu'une sélection, pas une ressource.
 *  2. La sélection se compose avec les filtres, qui sont déjà des query params
 *     (`parseRunsFilters`). `?run=` vit dans le même espace ; un segment de
 *     chemin l'en séparerait et il faudrait recoller les deux à chaque lien.
 *  3. `activeNavHref` illumine « Runs » sans travail supplémentaire : le
 *     pathname reste exactement `/runs`.
 * Un id inconnu ne 404 pas — il rend la liste + un détail qui DIT que le run
 * demandé n'est pas dans la fenêtre chargée (voir `resolveSelectedRun`).
 *
 * FILTRES (AIGENT-RUNTIME-PRODUCTIZATION-001). `parseRunsFilters` existait,
 * était testé, et n'était appelé par AUCUNE page : l'URL affichait le filtre et
 * la page renvoyait TOUT. Concrètement, l'onglet « Historique » d'une fiche
 * Agent (`/runs?copilot=X`) et l'onglet « Runs » d'une fiche Projet
 * (`/runs?project=X`) menaient à la flotte entière, et `buildHref` reconduisait
 * fidèlement le paramètre inerte à chaque clic. Il est maintenant branché ici,
 * et c'est le SEUL point de parsing — le composant de barre de filtres reçoit
 * l'état déjà parsé et ne le relit jamais.
 *
 * Le filtrage est un NARROWING EN MÉMOIRE de la fenêtre déjà lue : il ne relit
 * pas la base et ne prétend jamais atteindre plus loin que ce que
 * `getRunsPageData` a chargé. Les mesures sont ensuite dérivées du tableau
 * RÉELLEMENT rendu — filtrer la liste sans refiltrer les KPI afficherait des
 * chiffres qui ne décrivent pas ce qui est à l'écran.
 */
const ENTRY = navEntry('/runs')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// L'historique des runs est l'état vivant de la flotte : jamais de cache statique.
export const dynamic = 'force-dynamic'

type SearchParams = Record<string, string | string[] | undefined>

function firstValue(raw: string | string[] | undefined): string | null {
  if (Array.isArray(raw)) return raw[0] ?? null
  return raw ?? null
}

/**
 * Lecture en deux tiers, calquée sur la posture de `getRunsPageData` :
 *
 *  · les RUNS sont porteurs : si la lecture échoue, l'écran entier bascule en
 *    « indisponible ». Une fenêtre non lue n'est pas une flotte au repos.
 *  · la TÉLÉMÉTRIE est secondaire : son échec devient `provenance: null`, que le
 *    bandeau rend comme « part consommateur inconnue ». L'écran reste utile.
 *
 * Aucun des deux échecs ne produit de liste vide ni de zéro.
 */
async function loadRuns() {
  const pageDataResult = await Promise.allSettled([getRunsPageData()]).then((r) => r[0]!)

  if (pageDataResult.status === 'rejected') {
    // Détail réel au log serveur uniquement — jamais dans le HTML.
    console.error('[runs] lecture de la fenêtre de runs impossible', pageDataResult.reason)
    return { data: null, provenance: null }
  }

  // Le flux d'événements alimente la SEULE distinction interne/consommateur.
  // Son échec ne doit pas emporter l'écran, mais ne doit pas non plus être
  // silencieux : `null` remonte tel quel jusqu'au bandeau.
  let provenance: ProvenanceBreakdown | null = null
  try {
    provenance = countProvenance(await listRecentRuntimeTelemetryEvents(200))
  } catch {
    provenance = null
  }

  return { data: pageDataResult.value, provenance }
}

export default async function RunsPage({ searchParams }: { searchParams?: Promise<SearchParams> }) {
  const params = (await searchParams) ?? {}
  const requestedRunId = firstValue(params.run)

  const { data, provenance } = await loadRuns()

  // Backend muet : l'écran ne dégrade pas en « 0 run », il DIT qu'il ne sait pas.
  if (data === null) {
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="La fenêtre de runs n'a pas pu être lue. Aucun run n'est affiché — une liste vide laisserait croire que la flotte est au repos. Le détail technique est dans les logs du serveur."
        />
      </AppShell>
    )
  }

  // L'UNIQUE lecture de l'URL en état de filtre. `copilot=` est absorbé ici,
  // dans le parseur, pas réconcilié dans la page (voir `AGENT_PARAM_ALIASES`).
  const filters = parseRunsFilters(params)

  // Narrowing en mémoire de la fenêtre déjà lue. `applyRunsFilters` est la même
  // fonction que celle couverte par les tests ; il n'y a pas de second « quels
  // runs comptent » dans cet écran.
  const visibleRuns = applyRunsFilters(data.runs, filters, {
    agentNameById: data.agentNameById,
    projectNameById: data.projectNameById,
    nowMs: data.nowMs,
  })

  // UNE seule dérivation des mesures, sur le tableau réellement rendu.
  const metrics = deriveRunsMetrics(visibleRuns)

  /**
   * Les options des sélecteurs sont dérivées de la FENÊTRE COMPLÈTE, pas du
   * sous-ensemble filtré. Les dériver du filtré viderait la liste dès le premier
   * choix : après avoir sélectionné l'agent A, A serait la seule option, et
   * l'opérateur ne pourrait plus passer à B sans réinitialiser.
   *
   * Un id sans libellé résolu (lecture du roster dégradée) reste affiché comme
   * id brut : c'est ce que l'écran sait, et un nom inventé serait pire.
   */
  const agentOptions = [...new Set(data.runs.map((run) => run.copilotId))]
    .map((id) => ({ id, name: data.agentNameById.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  const projectOptions = [
    ...new Set(data.runs.flatMap((run) => (run.projectId ? [run.projectId] : []))),
  ]
    .map((id) => ({ id, name: data.projectNameById.get(id) ?? id }))
    .sort((a, b) => a.name.localeCompare(b.name, 'fr'))

  /**
   * Lien profond d'un run, filtres préservés. Il passe par `buildRunsHref`, la
   * même construction d'URL que la barre de filtres : cliquer une ligne ne
   * réinitialise aucun filtre, et l'URL produite est normalisée (`copilot=`
   * arrivé de l'onglet Agent ressort en `agent=`).
   */
  const buildHref = (runId: string): string => buildRunsHref(filters, runId)

  return (
    <AppShell>
      <RunsScreen
        runs={visibleRuns}
        metrics={metrics}
        filters={filters}
        filtersActive={hasActiveFilters(filters)}
        windowHasRuns={data.runs.length > 0}
        agentOptions={agentOptions}
        projectOptions={projectOptions}
        agentNameById={data.agentNameById}
        projectNameById={data.projectNameById}
        selectedRunId={requestedRunId}
        provenance={provenance}
        nowMs={data.nowMs}
        windowRunCount={data.windowRunCount}
        windowTruncated={data.windowTruncated}
        tableRowCap={data.tableRowCap}
        degradedDetail={data.degradedDetail}
        buildHref={buildHref}
      />
    </AppShell>
  )
}
