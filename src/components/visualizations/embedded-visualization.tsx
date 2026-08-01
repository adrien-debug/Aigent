'use client'

import { useRef, useState } from 'react'

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
   * La sonde serveur dit que Grafana répondait au moment du rendu. Elle ne dit
   * rien de ce que le NAVIGATEUR obtiendra ensuite : réseau coupé, requête
   * bloquée, contenu refusé. Sans ce garde, le cadre reste blanc sous un badge
   * `READY` — exactement le faux positif que cette mission interdit (constaté
   * au harnais, capture `unavailable-1440x900.png` de la première passe).
   *
   * `onError` ne suffit pas : une iframe vidée ne le déclenche pas toujours. On
   * vérifie donc aussi, après le `load`, qu'elle a bien reçu quelque chose.
   */
  const [frameFailed, setFrameFailed] = useState(false)
  const frameRef = useRef<HTMLIFrameElement | null>(null)

  const serverState = forcedState ?? viz.state
  const state = frameFailed && !forcedState ? 'UNAVAILABLE' : serverState
  const isReady = state === 'READY' && viz.embedUrl.length > 0

  function inspectFrame() {
    const frame = frameRef.current
    if (!frame) return
    // Cross-origin : lire `contentDocument` lève, et CETTE levée prouve que le
    // document distant est bien chargé. Un accès qui réussit signifie au
    // contraire une page `about:blank` — donc rien n'a été rendu.
    try {
      const doc = frame.contentDocument
      if (doc === null) return // cross-origin chargé : c'est le cas nominal.
      if (doc.body === null || doc.body.childElementCount === 0) setFrameFailed(true)
    } catch {
      // SecurityError ⇒ document distant chargé. Rien à signaler.
    }
  }

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
            ref={frameRef}
            src={viz.embedUrl}
            title={`${viz.title} — panneau Grafana ${viz.panelId}`}
            className="block h-full w-full border-0"
            style={{ minHeight: `${viz.minHeightPx}px` }}
            onLoad={inspectFrame}
            onError={() => setFrameFailed(true)}
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
                : viz.reason
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
