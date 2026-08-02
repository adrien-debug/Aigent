import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import QualificationRosterScreen from '@/components/qualification/roster-screen'
import { loadQualificationRoster } from '@/components/qualification/server-reads'
import { SurfaceUnavailable } from '@/components/surface-shell'
import { navEntry } from '@/components/navigation'

/**
 * Surface « /qualification » — le banc de qualification, branché.
 *
 * LECTURE EN SERVER COMPONENT, jamais via `/api/**`. Les mutations, elles,
 * partent obligatoirement en `fetch` vers `/api/agent-ops/**` depuis un
 * composant client : une Server Action POSTerait vers la route de cette page,
 * hors du `matcher` de `src/proxy.ts`, donc sur une frontière non gardée.
 *
 * DEUX ABSENCES, JAMAIS CONFONDUES. La lecture des copilots JETTE quand le
 * backend est injoignable, et rend une liste vide quand elle a réussi sur un
 * catalogue vide. La première est un « on ne sait pas », la seconde un « on sait
 * qu'il n'y a rien ». Les afficher pareil transformerait une panne en produit
 * sain.
 */
const ENTRY = navEntry('/qualification')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// Le banc lit l'état vivant du catalogue et des registres : jamais de cache.
export const dynamic = 'force-dynamic'

export default async function Page() {
  let roster: Awaited<ReturnType<typeof loadQualificationRoster>>
  try {
    roster = await loadQualificationRoster()
  } catch (err) {
    const failure = err instanceof Error ? err.message : 'lecture impossible'
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail={`Le banc de qualification n’a pas pu être lu. Aucune liste n’est affichée — une liste vide se lirait comme « aucun candidat », ce qui n’est pas ce qui est su.${failure ? ` (${failure})` : ''}`}
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <QualificationRosterScreen
        candidates={roster.candidates}
        qualificationReadFailures={roster.qualificationReadFailures}
      />
    </AppShell>
  )
}
