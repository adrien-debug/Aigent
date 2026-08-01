/**
 * Re-sonde d'une visualisation — AIGENT-VISUALIZATION-LAB-003.
 *
 * POURQUOI CETTE ROUTE EXISTE. La résolution initiale se fait au rendu serveur ;
 * elle dit que Grafana répondait à cet instant. Elle ne dit rien de ce que le
 * navigateur obtiendra ensuite — réseau coupé, requête bloquée, service arrêté
 * entre-temps. Sans re-sonde, un cadre blanc reste badgé `READY`, ce qui est
 * exactement le faux positif que cette mission interdit.
 *
 * POURQUOI PAS UNE DÉTECTION DANS L'IFRAME. `contentDocument` d'une iframe
 * cross-origin vaut `null` que le chargement ait réussi OU échoué : la valeur
 * ne discrimine rien (vérifié le 2026-08-02). Seul le serveur peut trancher, et
 * il le fait avec le MÊME résolveur que le rendu initial — pas un second chemin
 * qui divergerait.
 *
 * SÉCURITÉ. Sous `/api/agent-ops/**`, donc gardée par `src/proxy.ts`. Le client
 * n'envoie qu'un IDENTIFIANT ; aucune URL n'est acceptée, aucun proxy n'est
 * ouvert. La réponse ne porte ni URL d'embed ni secret — seulement un état.
 */
import { NextResponse } from 'next/server'

import { resolveVisualization } from '@/components/visualizations/embed/registry'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(
  _request: Request,
  context: { params: Promise<{ vizId: string }> },
): Promise<NextResponse> {
  const { vizId } = await context.params

  const resolved = await resolveVisualization(vizId)
  if (!resolved) {
    return NextResponse.json({ error: 'unknown visualization' }, { status: 404 })
  }

  // On ne renvoie QUE l'état et sa raison : l'URL d'embed a déjà été livrée au
  // rendu initial, la re-servir ici élargirait la surface sans rien apporter.
  return NextResponse.json(
    { id: resolved.id, state: resolved.state, reason: resolved.reason },
    { headers: { 'cache-control': 'no-store' } },
  )
}
