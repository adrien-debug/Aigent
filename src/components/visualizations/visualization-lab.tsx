'use client'

import { useState } from 'react'

import './visualizations.css'
import EmbeddedVisualization from './embedded-visualization'
import type { EnvelopeDensity, ResolvedVisualization, VisualizationState } from './embed/contract'

/**
 * Laboratoire de visualisations — AIGENT-VISUALIZATION-LAB-003.
 *
 * CE QUE CETTE PAGE SERT À DÉCIDER. Elle n'est pas une démo : elle existe pour
 * qu'Adrien tranche, sur de vraies données, la bonne architecture avant de la
 * généraliser aux routes produit. D'où trois choses côte à côte — les panneaux
 * réels, les six états de vérité, et deux densités d'enveloppe.
 *
 * LIVE ET DÉMO NE SE MÉLANGENT PAS. La galerie du haut est live : ce qu'elle
 * montre vient de Grafana à l'instant du rendu. Le banc d'états, en bas, est
 * une simulation et le dit — badge `DÉMO` sur chaque exemple, section
 * distincte, texte explicite. Aucun état simulé ne peut apparaître dans la
 * galerie live, et réciproquement.
 */

const DEMO_STATES: Exclude<VisualizationState, 'READY'>[] = [
  'LOADING',
  'CONNECTING',
  'EMPTY',
  'NOT_CONFIGURED',
  'UNAVAILABLE',
]

interface Props {
  visualizations: ResolvedVisualization[]
}

export default function VisualizationLab({ visualizations }: Readonly<Props>) {
  const [density, setDensity] = useState<EnvelopeDensity>('comfortable')

  const ready = visualizations.filter((v) => v.state === 'READY').length
  const total = visualizations.length

  return (
    <div className="viz-scope scroll-thin flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          {/*
            `max-lg:pl-12` — le shell pose son bouton de menu en haut à gauche
            sur les petits écrans, et il recouvrait la première lettre du titre
            à 375px. On dégage la gouttière plutôt que de rétrécir le titre.
          */}
          <h1 className="viz-title text-xl font-semibold max-lg:pl-12">
            Laboratoire de visualisations
          </h1>
          <span className="viz-provenance text-[11px]">
            {/*
              Compte DÉRIVÉ, jamais saisi : si une source tombe, ce chiffre
              baisse au rechargement suivant.
            */}
            {ready}/{total} panneau(x) joignable(s)
          </span>
        </div>
        <p className="viz-description max-w-3xl text-xs leading-relaxed">
          Les graphiques sont rendus par Grafana et les séries par Prometheus — rien n’est recodé
          ici. Aigent habille l’environnement : hiérarchie, provenance, état de vérité, action
          externe. Une iframe cross-origin ne peut pas être restylée depuis Aigent, et rien n’est
          superposé au-dessus des données.
        </p>

        {/* Comparateur de densité — même moteur, deux enveloppes. */}
        <div className="flex items-center gap-2" role="group" aria-label="Densité de l’enveloppe">
          {(['comfortable', 'compact'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDensity(d)}
              aria-pressed={density === d}
              data-testid={`density-${d}`}
              className={`viz-badge ${density === d ? 'viz-surface-overlay' : ''} viz-surface-interactive cursor-pointer`}
            >
              {d === 'comfortable' ? 'Confortable' : 'Compact'}
            </button>
          ))}
        </div>
      </header>

      {/* ------------------------------------------------------------ LIVE */}
      <section className="flex flex-col gap-3" aria-labelledby="live-heading" data-testid="viz-live-section">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="live-heading" className="viz-title text-sm font-semibold">
            Panneaux réels
          </h2>
          <span className="viz-provenance text-[11px]">
            état live à l’instant du rendu — aucune simulation dans cette section
          </span>
        </div>

        {/*
          Une visualisation par ligne sur mobile : une grille à deux colonnes à
          375px produirait des miniatures illisibles, ce qui vide la page de son
          intérêt. Deux colonnes seulement à partir de `xl`, où la largeur le
          permet réellement.
        */}
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {visualizations.map((viz) => (
            <EmbeddedVisualization key={viz.id} visualization={viz} density={density} />
          ))}
        </div>
      </section>

      {/* ------------------------------------------------------------ DÉMO */}
      <section className="flex flex-col gap-3" aria-labelledby="demo-heading" data-testid="viz-demo-section">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 id="demo-heading" className="viz-title text-sm font-semibold">
            Banc d’états
          </h2>
          <span className="viz-badge viz-badge-demo">DÉMO</span>
          <span className="viz-provenance text-[11px]">
            états simulés pour inspection — aucune source n’est interrogée ici
          </span>
        </div>

        <p className="viz-description max-w-3xl text-xs leading-relaxed">
          Ces cinq états sont <strong>forcés</strong> pour être inspectés côte à côte. Ils ne
          reflètent pas l’état réel des sources ci-dessus. Chacun porte le badge <code>DÉMO</code>.
          Le mouvement respecte <code>prefers-reduced-motion</code> et s’interrompt quand l’onglet
          n’est pas regardé ; sans mouvement, l’information reste entière.
        </p>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
          {DEMO_STATES.map((state) => {
            const model = visualizations[0]
            if (!model) return null
            return (
              <EmbeddedVisualization
                key={state}
                visualization={{
                  ...model,
                  id: `demo-${state.toLowerCase()}`,
                  title: `État · ${state}`,
                  description: 'Exemple forcé, à des fins d’inspection visuelle.',
                  minHeightPx: 200,
                  reason:
                    state === 'UNAVAILABLE'
                      ? 'Exemple : la source n’a pas répondu avant expiration du délai.'
                      : null,
                }}
                density={density}
                demo
                forcedState={state}
              />
            )
          })}
        </div>
      </section>
    </div>
  )
}
