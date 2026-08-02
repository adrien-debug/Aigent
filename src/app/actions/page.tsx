import type { Metadata } from 'next'
import { headers } from 'next/headers'

import AppShell, { PageBody, PageHeader } from '@/components/app-shell'
import QueueConsole from '@/components/actions/queue-console'
import { getActionsPageData } from '@/components/actions/server-reads'
import { navEntry } from '@/components/navigation'
import { getObsidianConfig } from '@/lib/agent-mission-control/obsidian-bridge'

/**
 * Surface « /actions » — la file opérateur COMPLÈTE, branchée.
 *
 * Cette page était un `SurfacePlaceholder` : elle ne lisait rien et le disait.
 * Elle lit désormais la file réelle. Le titre et l'intention viennent toujours
 * de `NAVIGATION`, source unique, pour que la page ne puisse pas diverger de
 * l'entrée de nav qui y mène.
 *
 * Server Component : toute l'I/O est ici, la console cliente ne reçoit que des
 * données déjà dérivées. `getObsidianConfig()` est résolu ICI — il lit
 * `process.env`, donc il ne doit jamais partir dans le bundle navigateur ; le
 * nom de vault qui en sort n'est pas un secret.
 *
 * `dynamic = 'force-dynamic'` : une file d'action mise en cache est une file
 * fausse. L'opérateur doit voir l'état au moment où il regarde.
 */
const ENTRY = navEntry('/actions')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }
export const dynamic = 'force-dynamic'

/**
 * L'origine publique, lue sur la requête.
 *
 * Elle sert UNIQUEMENT à écrire des liens de preuve cliquables dans une note
 * Obsidian. Résolue côté serveur — la lire depuis `window` dans le composant
 * client produirait deux rendus divergents et une erreur d'hydratation.
 * Quand l'en-tête manque, on retombe sur des chemins RELATIFS : inertes dans
 * une note, mais honnêtes, là où une origine devinée pointerait ailleurs.
 */
async function resolveOrigin(): Promise<string> {
  const headerList = await headers()
  const host = headerList.get('x-forwarded-host') ?? headerList.get('host')
  if (!host) return ''
  const protocol =
    headerList.get('x-forwarded-proto') ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https')
  return `${protocol}://${host}`
}

export default async function Page() {
  const { queue, proposalScanTruncated, proposalScanCount } = await getActionsPageData()
  const obsidian = getObsidianConfig()
  const origin = await resolveOrigin()

  return (
    <AppShell>
      <PageHeader title={ENTRY.name} description={ENTRY.purpose} />
      <PageBody>
        <QueueConsole
          queue={queue}
          obsidian={obsidian}
          origin={origin}
          proposalScanTruncated={proposalScanTruncated}
          proposalScanCount={proposalScanCount}
        />
      </PageBody>
    </AppShell>
  )
}
