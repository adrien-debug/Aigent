import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import RunsScreen from '@/components/runs/runs-screen'
import { countProvenance } from '@/components/runs/run-view-model'
import type { ProvenanceBreakdown } from '@/components/runs/run-view-model'
import { Unavailable } from '@/components/cockpit/primitives'
import { Text } from '@/components/ui/text'
import { navEntry } from '@/components/navigation'
import { listRecentRuntimeTelemetryEvents } from '@/lib/agent-mission-control/runtime-telemetry-store'
import { deriveRunsMetrics } from '@/lib/runs-console/runs-metrics'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'

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
    const err = pageDataResult.reason
    return {
      data: null,
      provenance: null,
      failure: err instanceof Error ? err.message : 'lecture impossible',
    }
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

  return { data: pageDataResult.value, provenance, failure: null as string | null }
}

export default async function RunsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>
}) {
  const params = (await searchParams) ?? {}
  const requestedRunId = firstValue(params.run)

  const { data, provenance, failure } = await loadRuns()

  // Backend muet : l'écran ne dégrade pas en « 0 run », il DIT qu'il ne sait pas.
  if (data === null) {
    return (
      <AppShell>
        <div className="h-full p-4">
          <div className="flex h-full items-center justify-center rounded-lg bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10">
            <div className="max-w-md px-6 text-center">
              <Unavailable
                reason="unread"
                detail="La fenêtre de runs n'a pas pu être lue. Aucun run n'est affiché — une liste vide laisserait croire que la flotte est au repos."
              />
              {failure ? <Text className="mt-3">{failure}</Text> : null}
            </div>
          </div>
        </div>
      </AppShell>
    )
  }

  // UNE seule dérivation des mesures, sur le tableau réellement rendu.
  const metrics = deriveRunsMetrics(data.runs)

  /**
   * Lien profond d'un run, filtres préservés. Tout ce qui était dans l'URL y
   * reste : cliquer une ligne ne doit pas réinitialiser silencieusement un
   * filtre que l'opérateur a posé.
   */
  const buildHref = (runId: string): string => {
    const next = new URLSearchParams()
    for (const [key, raw] of Object.entries(params)) {
      if (key === 'run') continue
      const value = firstValue(raw)
      if (value !== null && value !== '') next.set(key, value)
    }
    next.set('run', runId)
    return `/runs?${next.toString()}`
  }

  return (
    <AppShell>
      <RunsScreen
        runs={data.runs}
        metrics={metrics}
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
