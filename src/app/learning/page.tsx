import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import LearningScreen from '@/components/learning/learning-screen'
import { navEntry } from '@/components/navigation'
import { getLearningOverview } from '@/lib/agent-mission-control/learning-overview'
import { getObsidianConfig } from '@/lib/agent-mission-control/obsidian-bridge'

/**
 * Surface « /learning » — le poste de supervision et d'amélioration.
 *
 * Server Component : toute l'I/O est ici. `getLearningOverview` compose les
 * getters existants (il ne recopie aucune de leurs règles) et
 * `getObsidianConfig` lit `process.env` — donc les deux restent côté serveur,
 * et seul le résultat dérivé descend vers l'écran.
 *
 * `dynamic = 'force-dynamic'` : une supervision mise en cache est une
 * supervision fausse.
 */
const ENTRY = navEntry('/learning')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }
export const dynamic = 'force-dynamic'

export default async function Page() {
  const overview = await getLearningOverview()
  const obsidian = getObsidianConfig()

  return (
    <AppShell>
      <LearningScreen
        overview={overview}
        obsidian={obsidian}
        title={ENTRY.name}
        purpose={ENTRY.purpose}
      />
    </AppShell>
  )
}
