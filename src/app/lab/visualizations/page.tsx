import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import AppShell from '@/components/app-shell'
import VisualizationLab from '@/components/visualizations/visualization-lab'
import { resolveAllVisualizations } from '@/components/visualizations/embed/registry'

/**
 * Route `/lab/visualizations` — laboratoire de visualisations, HORS PRODUCTION.
 *
 * Même doctrine que `/lab` : `notFound()` en production. Cette page montre des
 * panneaux réels ET des simulations d'états ; en production, la cohabitation
 * des deux serait une source de confusion, quel que soit le badge.
 *
 * SERVER COMPONENT PAR NÉCESSITÉ. La résolution des visualisations lit
 * l'environnement et sonde Grafana : elle ne peut pas descendre côté client
 * sans exposer l'allowlist et transformer le composant en proxy ouvert. Le
 * client ne reçoit que des URL déjà validées.
 */
export const metadata: Metadata = { title: 'Aigent · Laboratoire de visualisations' }

// Les sondes doivent refléter l'état courant, pas un rendu mis en cache.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function Page() {
  if (process.env.NODE_ENV === 'production') notFound()

  const visualizations = await resolveAllVisualizations()

  return (
    <AppShell>
      <VisualizationLab visualizations={visualizations} />
    </AppShell>
  )
}
