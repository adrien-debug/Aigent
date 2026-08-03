import type { Metadata } from 'next'
import { headers } from 'next/headers'

import AppShell, { PageBody, PageHeader } from '@/components/app-shell'
import QueueConsole from '@/components/actions/queue-console'
import { getActionsPageData } from '@/components/actions/server-reads'
import { navEntry } from '@/components/navigation'
import { getObsidianConfig } from '@/lib/agent-mission-control/obsidian-bridge'

/**
 * Route `/support` — ce qui demande une intervention, rassemblé.
 *
 * POURQUOI CETTE SURFACE EXISTE (AIGENT-UX-IA-001, #93). La nouvelle
 * architecture de navigation compte six entrées, dont « Support ». Le produit
 * avait la MATIÈRE — la file d'action de `/actions` porte déjà décisions à
 * prendre, livraisons bloquées, agents dégradés et signaux — mais pas le NOM :
 * un opérateur qui cherche « ce qui va mal » ne devine pas qu'il faut ouvrir un
 * écran appelé « Actions ».
 *
 * ELLE NE DUPLIQUE RIEN. Même lecture (`getActionsPageData`), même composant
 * (`QueueConsole`) : c'est la même file, sous le nom que l'opérateur cherche.
 * Réécrire un second écran aurait créé deux vérités sur la même donnée, et
 * l'issue interdit la duplication de contenu autant que la perte de capacité.
 *
 * `/actions` reste servie : un signet ou un lien profond continue de marcher.
 * Les deux routes s'allument sur « Support » dans le rail (`HOME_SECTION`).
 *
 * `dynamic = 'force-dynamic'` : une file d'action mise en cache est une file
 * fausse. L'opérateur doit voir l'état au moment où il regarde.
 */
const ENTRY = navEntry('/support')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }
export const dynamic = 'force-dynamic'

/**
 * L'origine publique, lue sur la requête — identique à `/actions`.
 *
 * Elle sert UNIQUEMENT à écrire des liens de preuve cliquables dans une note
 * Obsidian. Quand l'en-tête manque, on retombe sur des chemins RELATIFS :
 * inertes dans une note, mais honnêtes, là où une origine devinée pointerait
 * ailleurs.
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
