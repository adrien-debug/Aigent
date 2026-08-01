'use client'

import { useEffect, useState } from 'react'

import type { EnvelopeDensity, ResolvedVisualization } from './embed/contract'
import VisualizationStateView from './states/visualization-state'

/**
 * L'enveloppe Aigent autour d'un panneau source — AIGENT-VISUALIZATION-LAB-003.
 *
 * PARTAGE DES RÔLES. Aigent possède le cadre : titre, description, provenance,
 * état de vérité, action externe, responsive. Grafana possède TOUT ce qui est
 * dans l'iframe — série, axes, légende, tooltip, thème du contenu.
 *
 * AUCUN OVERLAY AU-DESSUS DES DONNÉES. Une iframe cross-origin ne peut pas être
 * restylée depuis ici, et poser un calque par-dessus pour « harmoniser » ne
 * ferait que masquer de l'information réelle. Le badge d'état vit donc dans
 * l'en-tête, à côté du graphique, jamais dessus.
 *
 * PAS DE DOUBLE TITRE. Les panneaux `stat` de Grafana portent déjà leur libellé ;
 * l'enveloppe n'ajoute qu'un titre de section, et la métrique n'est pas
 * réencadrée dans une carte Aigent supplémentaire.
 */

interface Props {
  visualization: ResolvedVisualization
  density?: EnvelopeDensity
  /** Marque une simulation. Une démo ne doit JAMAIS passer pour du live. */
  demo?: boolean
  /** Force un état — réservé au sélecteur de démonstration du laboratoire. */
  forcedState?: ResolvedVisualization['state']
}

export default function EmbeddedVisualization({
  visualization: viz,
  density = 'comfortable',
  demo = false,
  forcedState,
}: Readonly<Props>) {
  /*
   * L'IFRAME PEUT ÉCHOUER APRÈS UNE SONDE RÉUSSIE.
   *
   * La résolution serveur dit que Grafana répondait AU RENDU. Elle ne dit rien
   * de ce que le navigateur obtiendra ensuite : réseau coupé, requête bloquée,
   * service arrêté entre-temps. Sans re-vérification, le cadre reste blanc sous
   * un badge `READY` — le faux positif que cette mission interdit (constaté au
   * harnais, première passe de `unavailable-1440x900.png`).
   *
   * On re-sonde donc côté SERVEUR après montage. Détecter depuis l'iframe est
   * impossible : `contentDocument` d'une iframe cross-origin vaut `null` que le
   * chargement ait réussi ou échoué — la valeur ne discrimine rien (vérifié le
   * 2026-08-02).
   */
  const [liveState, setLiveState] = useState<ResolvedVisualization['state'] | null>(null)
  const [liveReason, setLiveReason] = useState<string | null>(null)

  useEffect(() => {
    // Une démo ne sonde rien : son état est forcé, par définition.
    if (forcedState || demo) return
    const controller = new AbortController()
    fetch(`/api/agent-ops/visualizations/${viz.id}`, {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        setLiveState(data.state)
        setLiveReason(data.reason ?? null)
      })
      .catch(() => {
        // La re-sonde elle-même est injoignable : on ne peut plus affirmer
        // `READY`. Dégrader est le seul choix honnête.
        setLiveState('UNAVAILABLE')
        setLiveReason('La vérification de la source n’a pas abouti.')
      })
    return () => controller.abort()
  }, [viz.id, forcedState, demo])

  const state = forcedState ?? liveState ?? viz.state
  const reason = forcedState ? viz.reason : (liveReason ?? viz.reason)
  const isReady = state === 'READY' && viz.embedUrl.length > 0

  const pad = density === 'compact' ? 'p-3' : 'p-5'
  const gap = density === 'compact' ? 'gap-2' : 'gap-3'

  return (
    <figure
      className={`viz-envelope viz-surface-base flex flex-col ${gap} ${pad} rounded-xl`}
      data-testid="embedded-visualization"
      data-viz={viz.id}
      data-state={state}
      data-demo={demo ? 'true' : 'false'}
      data-density={density}
    >
      <figcaption className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <h3 className="viz-title text-sm font-semibold">{viz.title}</h3>

          {/* L'état est écrit en toutes lettres, à côté du titre — pas dessus. */}
          <span className="viz-badge" data-badge-state={state}>
            {state}
          </span>

          {demo ? (
            /*
              Le badge DEMO est obligatoire et visuellement distinct : une
              simulation confondue avec du live invaliderait toute la page.
            */
            <span className="viz-badge viz-badge-demo" data-testid="demo-badge">
              DÉMO
            </span>
          ) : null}

          <span className="viz-mode text-[11px]">{viz.kind}</span>
        </div>

        <p className="viz-description text-xs leading-relaxed">{viz.description}</p>
      </figcaption>

      <div
        className="viz-frame viz-surface-subtle overflow-hidden rounded-lg"
        style={{ minHeight: `${viz.minHeightPx}px` }}
      >
        {isReady ? (
          <iframe
            src={viz.embedUrl}
            title={`${viz.title} — panneau Grafana ${viz.panelId}`}
            className="block h-full w-full border-0"
            style={{ minHeight: `${viz.minHeightPx}px` }}
            // `eager` : `lazy` laisse les panneaux hors écran non chargés, donc
            // non vérifiables — un cadre vide ne se distinguerait pas d'un
            // cadre en attente.
            loading="eager"
            // L'iframe ne peut ni naviguer au sommet, ni ouvrir de popup, ni
            // soumettre de formulaire. Elle n'a besoin que d'exécuter le JS de
            // Grafana pour dessiner.
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            data-testid="viz-iframe"
          />
        ) : (
          <VisualizationStateView
            /*
              `READY` sans URL rendable est un cas RÉEL, pas une impossibilité :
              le résolveur vide `embedUrl` dès qu'un verrou refuse la source. On
              le dégrade en `UNAVAILABLE` — afficher « READY » sur un cadre vide
              serait précisément le faux positif que cette mission interdit.
            */
            state={state === 'READY' ? 'UNAVAILABLE' : state}
            reason={
              state === 'READY'
                ? 'La source est déclarée prête mais aucune URL vérifiée n’a été résolue.'
                : reason
            }
            minHeightPx={viz.minHeightPx}
            diagnosticHref={viz.sourceUrl || null}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {/* La provenance remonte jusqu'au producteur : d'où viennent ces chiffres. */}
        <p className="viz-provenance text-[11px]">{viz.provenance}</p>

        {viz.sourceUrl ? (
          <a
            className="viz-action shrink-0 text-xs"
            href={viz.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            data-testid="viz-open-source"
          >
            Ouvrir dans Grafana ↗
          </a>
        ) : null}
      </div>
    </figure>
  )
}
