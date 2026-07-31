import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import { navEntry } from '@/components/navigation'
import RuntimeScreen, { type RuntimeScreenData } from '@/components/runtime/runtime-screen'
import { resolveRuntimeTab } from '@/components/runtime/model'
import {
  readLangGraphTab,
  readModelsTab,
  readProvidersTab,
  readRepositoriesTab,
  readTelemetryTab,
  readToolsTab,
} from '@/components/runtime/server-reads'
import { readVisualTooling } from '@/components/runtime/visual-tooling'

/**
 * Surface « /runtime » — six onglets sur l'état RÉEL du plan d'exécution.
 *
 * L'ONGLET VIT DANS L'URL. `?tab=` plutôt qu'un état client, pour quatre
 * propriétés qu'un `useState` aurait toutes rendues fausses d'un coup : le deep
 * link fonctionne, le rechargement direct retombe sur le bon onglet, le bouton
 * retour fait ce qu'on attend, et l'entrée de navigation « Runtime » reste
 * active parce que le pathname ne bouge jamais. Une valeur inconnue retombe sur
 * l'onglet par défaut — le paramètre décore une surface qui existe, il ne la
 * désigne pas — et n'est jamais réinjectée brute dans le rendu.
 *
 * LECTURE PAR ONGLET, ET SEULEMENT LUI. Chaque onglet interroge sa propre
 * source ; aucun ne paie pour les cinq autres. Un Agent Server éteint
 * n'assombrit donc pas l'onglet Télémétrie, qui lit Postgres.
 *
 * LECTURE SEULE. Cette surface n'écrit rien : aucun run, aucun provisioning,
 * aucune écriture GitHub, aucun appel LLM. Les seules fonctions appelées lisent
 * ou sont pures.
 *
 * Une lecture échouée ne dégénère jamais en liste vide : l'échec est conservé et
 * chaque panneau rend « je n'ai pas pu lire » distinctement de « il n'y a rien ».
 * Sur une surface dont le sujet EST ce qui est câblé ou non, confondre les deux
 * produirait le diagnostic exactement inverse du vrai.
 */
const ENTRY = navEntry('/runtime')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// L'état du plan d'exécution est vivant par nature : jamais de cache statique.
export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const current = resolveRuntimeTab(params.tab)

  // `switch` exhaustif sur l'union : chaque branche ne lit QUE sa source, et le
  // type garantit qu'aucun onglet ne peut être servi avec la charge d'un autre.
  let payload: RuntimeScreenData
  switch (current) {
    case 'telemetry':
      payload = { tab: 'telemetry', data: await readTelemetryTab() }
      break
    case 'langgraph':
      payload = { tab: 'langgraph', data: await readLangGraphTab() }
      break
    case 'tools':
      payload = { tab: 'tools', data: await readToolsTab() }
      break
    case 'providers':
      payload = { tab: 'providers', data: await readProvidersTab() }
      break
    case 'models':
      payload = { tab: 'models', data: await readModelsTab() }
      break
    case 'repositories':
      payload = { tab: 'repositories', data: await readRepositoriesTab() }
      break
    case 'visual-tooling':
      payload = { tab: 'visual-tooling', data: await readVisualTooling() }
      break
  }

  return (
    <AppShell>
      <RuntimeScreen current={current} payload={payload} />
    </AppShell>
  )
}
