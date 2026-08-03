import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import SettingsScreen from '@/components/settings/settings-screen'
import { SurfaceUnavailable } from '@/components/surface-shell'
import { navEntry } from '@/components/navigation'
import { getSettingsPostureSnapshot } from '@/lib/agent-mission-control/settings-posture'

/**
 * Surface « /settings » — la posture de configuration, EN LECTURE SEULE.
 *
 * Le contrat serveur (`settings-posture.ts`) existait déjà et n'avait aucun
 * appelant : cette page le CONSOMME, elle ne réinvente pas sa dérivation. Le
 * titre et l'intention viennent de `NAVIGATION`, source unique, donc la page ne
 * peut pas diverger de l'entrée de nav qui y mène.
 *
 * LECTURE DIRECTE, PAS UN FETCH VERS SA PROPRE API. La route
 * `/api/agent-ops/settings/posture` reste la surface machine ; une page serveur
 * qui s'appellerait elle-même en HTTP paierait un aller-retour réseau, devrait
 * refabriquer son propre cookie de session, et transformerait une erreur de
 * configuration en erreur de transport. Les deux appellent la MÊME fonction, il
 * n'y a donc pas deux vérités.
 *
 * `force-dynamic` : la posture est vivante par nature. Une page mise en cache
 * affirmerait qu'une clé est présente longtemps après son retrait — exactement
 * le genre d'affirmation périmée qu'un plan de contrôle ne doit pas produire.
 *
 * UNE LECTURE ÉCHOUÉE NE DÉGÉNÈRE PAS EN « TOUT EST ABSENT ». Sur une surface
 * dont le sujet EST ce qui est configuré, rendre un snapshot vide après une
 * exception dirait le contraire exact de ce qui est su. L'échec est donc rendu
 * comme un échec de lecture, distinct de « non configuré ».
 */
const ENTRY = navEntry('/settings')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

export const dynamic = 'force-dynamic'

export default async function Page() {
  let posture: Awaited<ReturnType<typeof getSettingsPostureSnapshot>>
  try {
    posture = await getSettingsPostureSnapshot()
  } catch {
    // Aucun détail interne n'est renvoyé au client : ni message d'exception, ni
    // nom de variable issu de l'erreur. Le détail reste au log serveur.
    return (
      <AppShell>
        <SurfaceUnavailable
          title={ENTRY.name}
          description={ENTRY.purpose}
          detail="La posture de configuration n’a pas pu être lue. Ce n’est pas la preuve qu’elle est absente : rien n’est affirmé sur ce qui est configuré."
        />
      </AppShell>
    )
  }

  return (
    <AppShell>
      <SettingsScreen posture={posture} />
    </AppShell>
  )
}
