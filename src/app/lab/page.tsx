import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import LabScreen from '@/components/lab/lab-screen'

/**
 * Route `/lab` — le laboratoire d'interaction, HORS PRODUCTION.
 *
 * POURQUOI UN 404 EN PRODUCTION PLUTÔT QU'UNE PAGE CACHÉE
 * ------------------------------------------------------
 * Une page de fabrication laissée accessible en production finit toujours par
 * être lue comme du produit : les données y sont inventées, et un opérateur qui
 * tombe dessus n'a aucun moyen de le savoir avant d'avoir lu le petit texte.
 * `notFound()` supprime la question — la route n'existe pas là-bas.
 *
 * Ce n'est PAS une garde de sécurité et ne doit jamais être présentée comme
 * telle : elle ne protège aucune donnée (il n'y en a pas), elle évite une
 * confusion. La vraie frontière de confiance du produit reste `src/proxy.ts`
 * sur `/api/agent-ops/**`.
 *
 * Cette page ne figure pas dans `NAVIGATION` : la carte de navigation décrit le
 * plan de contrôle, pas les outils qui servent à le fabriquer. On atteint `/lab`
 * en tapant l'URL, en dev.
 */
export const metadata: Metadata = { title: 'Aigent · Laboratoire' }

export default function Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  return (
    <AppShell>
      <LabScreen />
    </AppShell>
  )
}
