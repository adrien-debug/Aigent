import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import SurfacePlaceholder from '@/components/surface-placeholder'
import { navEntry } from '@/components/navigation'

/**
 * Surface « /runs » — nommée, navigable, PAS branchée.
 *
 * Le titre et l'intention viennent de `NAVIGATION`, source unique : la page ne
 * réécrit pas son propre libellé, donc elle ne peut pas diverger de l'entrée de
 * nav qui y mène. Cette page ne lit RIEN — aucun appel PostgREST, aucun chiffre.
 */
const ENTRY = navEntry('/runs')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

export default function Page() {
  return (
    <AppShell>
      <SurfacePlaceholder title={ENTRY.name} purpose={ENTRY.purpose} plannedIn="PR 2" />
    </AppShell>
  )
}
