import type { Metadata } from 'next'

import AppShell from '@/components/app-shell'
import DeliveryRosterScreen from '@/components/delivery/roster-screen'
import { loadDeliveryRoster } from '@/components/delivery/server-reads'
import SurfaceState from '@/components/surface-state'
import { navEntry } from '@/components/navigation'

/**
 * Surface « /delivery » — le banc de livraison, branché sur des lectures réelles.
 *
 * LECTURE EN SERVER COMPONENT, jamais via `/api/**`. La page appelle
 * `loadDeliveryRoster` directement, qui compose les résolveurs existants de
 * `src/lib/agent-mission-control/**`. Une route API rajouterait un aller-retour
 * HTTP, une seconde frontière d'auth et une seconde occasion de diverger du
 * contrat. Les mutations, elles, passent obligatoirement par `/api/agent-ops/**`
 * depuis le composant client — voir `components/delivery/console.tsx`.
 *
 * DEUX ABSENCES, JAMAIS CONFONDUES. `loadDeliveryRoster` JETTE quand le registre
 * des copilots est injoignable, et rend une liste vide quand la lecture a réussi
 * sur un catalogue vide. La première est un état « indisponible » (on ne sait
 * pas), la seconde un état « vide » (on sait qu'il n'y a rien). Les afficher
 * pareil transformerait une panne en produit sain.
 *
 * AUCUNE ÉCRITURE ICI. Cette page ne poste rien, n'appelle aucune route mutante
 * — pas même en dry-run — et n'arme aucun verrou de shipping. Elle lit l'état du
 * verrou pour le DÉCRIRE, ce qui est l'inverse de l'ouvrir.
 */
const ENTRY = navEntry('/delivery')

export const metadata: Metadata = { title: `Aigent · ${ENTRY.name}` }

// Le banc lit l'état vivant des livraisons : jamais de cache statique.
export const dynamic = 'force-dynamic'

async function loadBench() {
  try {
    return { read: await loadDeliveryRoster(), failure: null as string | null }
  } catch (err) {
    return {
      read: null,
      failure: err instanceof Error ? err.message : 'lecture impossible',
    }
  }
}

export default async function Page() {
  const { read, failure } = await loadBench()

  // Registre muet : l'écran DIT qu'il ne sait pas. Il ne rend pas une liste
  // vide, qui se lirait comme « aucun agent à livrer » — l'inverse de la vérité.
  if (read === null) {
    return (
      <AppShell>
        <div className="h-full p-4 max-lg:pt-20">
          <div className="aig-panel flex h-full items-center justify-center">
            {/* Le flux interrompu : la source EXISTE, c'est la lecture qui
                a echoue. Meme geste sur toutes les surfaces — un operateur
                reconnait l'etat sans relire le texte. */}
            <SurfaceState
              kind="unavailable"
              detail={`Le registre des copilots n’a pas pu être lu. Aucun banc de livraison n’est affiché — une liste vide se lirait comme « aucun agent », ce qui n’est pas ce qui est su.${failure ? ` (${failure})` : ''}`}
            />
          </div>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell>
      <DeliveryRosterScreen
        rows={read.rows}
        deliveryReadFailures={read.deliveryReadFailures}
        telemetry={read.telemetry}
        telemetryFailure={read.telemetryFailure}
        realDeliveryEnabled={read.realDeliveryEnabled}
      />
    </AppShell>
  )
}
