'use client'

import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import type { VisualizationState } from '../embed/contract'

/**
 * Les cinq états non-READY d'une visualisation — AIGENT-VISUALIZATION-LAB-003.
 *
 * CE QUE CES ÉTATS NE FONT JAMAIS. Ils ne suggèrent aucune valeur, aucun
 * pourcentage, aucune progression. Un squelette qui dessine des barres de
 * hauteurs plausibles laisse croire à une tendance ; une barre de progression
 * inventée laisse croire qu'on sait combien de temps ça prendra. Ici, les
 * formes sont neutres et les textes disent exactement ce qu'on sait.
 *
 * ACCESSIBILITÉ. L'état est écrit en toutes lettres et annoncé par `aria-live`.
 * Ni la couleur ni le mouvement ne portent d'information seuls : coupez les
 * deux, le texte suffit. `useReducedMotion()` bascule sur un rendu strictement
 * statique — l'information reste entière, seul le mouvement disparaît.
 *
 * `SurfacePlaceholder` n'est PAS réutilisé : il signifie « route nommée mais
 * non construite », ce qui n'a rien à voir avec « graphique dont la source est
 * momentanément muette ». Confondre les deux ferait mentir les deux.
 */

interface Props {
  state: Exclude<VisualizationState, 'READY'>
  /** Raison lisible, fournie par le résolveur. Jamais un secret. */
  reason?: string | null
  /** Hauteur du cadre — celle du panneau réel, pour éviter tout saut de layout. */
  minHeightPx?: number
  /** Action de diagnostic sûre (lecture seule), affichée sur `UNAVAILABLE`. */
  diagnosticHref?: string | null
}

/** Ce que chaque état signifie, en clair. La couleur ne suffit pas. */
const LABEL: Record<Exclude<VisualizationState, 'READY'>, string> = {
  LOADING: 'Chargement',
  CONNECTING: 'Connexion à la source',
  EMPTY: 'Aucune série sur cette fenêtre',
  NOT_CONFIGURED: 'Source non configurée',
  UNAVAILABLE: 'Source indisponible',
}

const EXPLANATION: Record<Exclude<VisualizationState, 'READY'>, string> = {
  LOADING: 'La requête est partie. Aucune valeur n’est encore connue.',
  CONNECTING: 'La source est joignable ; la liaison n’est pas encore établie.',
  EMPTY: 'La lecture a réussi, mais aucune série ne correspond à la fenêtre demandée. Ce n’est pas un zéro.',
  NOT_CONFIGURED: 'Aucune adresse n’est renseignée pour cette source : elle n’a jamais été sondée.',
  UNAVAILABLE: 'L’adresse est connue mais la source n’a pas répondu comme attendu.',
}

/** Rôle de surface par état — teinte, jamais porteuse d'information seule. */
const ROLE: Record<Exclude<VisualizationState, 'READY'>, string> = {
  LOADING: 'viz-surface-subtle',
  CONNECTING: 'viz-surface-subtle',
  EMPTY: 'viz-surface-base',
  NOT_CONFIGURED: 'viz-surface-base',
  UNAVAILABLE: 'viz-surface-raised',
}

/** Vrai quand l'onglet est masqué — on suspend alors les animations décoratives. */
function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const onChange = () => setVisible(document.visibilityState === 'visible')
    onChange()
    document.addEventListener('visibilitychange', onChange)
    return () => document.removeEventListener('visibilitychange', onChange)
  }, [])
  return visible
}

/**
 * `LOADING` — une architecture fantôme qui se compose.
 *
 * Trois bandes de largeurs FIXES : rien n'est aléatoire, rien ne ressemble à
 * une donnée. Elles apparaissent en cascade pour signifier « ça arrive »,
 * jamais « voici à quoi ça ressemblera ».
 */
function LoadingArt({ animate }: Readonly<{ animate: boolean }>) {
  const bars = [42, 68, 55]
  return (
    <div className="flex w-full max-w-sm flex-col gap-2" aria-hidden="true">
      {bars.map((width, i) => (
        <motion.div
          key={width}
          className="viz-skeleton h-2 rounded-full"
          style={{ width: `${width}%` }}
          initial={animate ? { opacity: 0.25 } : false}
          animate={animate ? { opacity: [0.25, 0.5, 0.25] } : undefined}
          transition={
            animate
              ? { duration: 2.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.18 }
              : undefined
          }
        />
      ))}
    </div>
  )
}

/**
 * `CONNECTING` — deux nœuds qui cherchent une liaison.
 *
 * Le trait pulse entre les deux points sans jamais se remplir : il n'y a
 * AUCUN pourcentage à montrer, et en inventer un serait un mensonge.
 */
function ConnectingArt({ animate }: Readonly<{ animate: boolean }>) {
  return (
    <div className="flex items-center gap-3" aria-hidden="true">
      <span className="viz-node size-2.5 rounded-full" />
      <div className="viz-link relative h-px w-24 overflow-hidden">
        {animate ? (
          <motion.span
            className="viz-link-pulse absolute inset-y-0 w-8"
            initial={{ x: '-100%' }}
            animate={{ x: '300%' }}
            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}
      </div>
      <span className="viz-node size-2.5 rounded-full" />
    </div>
  )
}

/** `EMPTY` — la structure d'un graphe en filigrane, sans aucune série. */
function EmptyArt() {
  return (
    <svg viewBox="0 0 120 60" className="viz-blueprint h-16 w-40" aria-hidden="true">
      <line x1="10" y1="50" x2="112" y2="50" strokeWidth="1" />
      <line x1="10" y1="6" x2="10" y2="50" strokeWidth="1" />
      {[18, 30, 42].map((y) => (
        <line key={y} x1="10" y1={y} x2="112" y2={y} strokeWidth="0.5" strokeDasharray="2 4" />
      ))}
    </svg>
  )
}

/** `NOT_CONFIGURED` — un blueprint : le branchement manque, il n'est pas cassé. */
function BlueprintArt() {
  return (
    <svg viewBox="0 0 120 60" className="viz-blueprint h-16 w-40" aria-hidden="true">
      <rect x="10" y="12" width="38" height="36" rx="3" strokeWidth="1" strokeDasharray="3 3" />
      <rect x="72" y="12" width="38" height="36" rx="3" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="48" y1="30" x2="72" y2="30" strokeWidth="1" strokeDasharray="3 3" />
    </svg>
  )
}

/** `UNAVAILABLE` — un flux interrompu. La rupture est explicite, pas décorative. */
function InterruptedArt() {
  return (
    <svg viewBox="0 0 120 60" className="viz-interrupted h-16 w-40" aria-hidden="true">
      <line x1="10" y1="30" x2="48" y2="30" strokeWidth="1.5" />
      <line x1="72" y1="30" x2="110" y2="30" strokeWidth="1.5" />
      <line x1="53" y1="20" x2="67" y2="40" strokeWidth="1.5" />
      <line x1="67" y1="20" x2="53" y2="40" strokeWidth="1.5" />
    </svg>
  )
}

export default function VisualizationStateView({
  state,
  reason,
  minHeightPx = 220,
  diagnosticHref,
}: Readonly<Props>) {
  const reducedMotion = useReducedMotion()
  const visible = useDocumentVisible()

  /*
   * MONTÉ CÔTÉ CLIENT AVANT D'ANIMER.
   *
   * `useReducedMotion()` vaut `null` au rendu serveur et sa vraie valeur après
   * hydratation : rendre l'animation dès la première passe produit un HTML
   * serveur différent du HTML client, donc une erreur « Hydration failed »
   * (constatée au harnais). On rend donc STATIQUE au premier passage, puis on
   * anime — le contenu informatif, lui, est identique dans les deux cas, donc
   * rien n'est perdu pour un lecteur sans JavaScript.
   */
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Animer seulement une fois monté, si l'utilisateur l'accepte ET que
  // l'onglet est regardé.
  const animate = mounted && !reducedMotion && visible

  const art = (() => {
    switch (state) {
      case 'LOADING':
        return <LoadingArt animate={animate} />
      case 'CONNECTING':
        return <ConnectingArt animate={animate} />
      case 'EMPTY':
        return <EmptyArt />
      case 'NOT_CONFIGURED':
        return <BlueprintArt />
      case 'UNAVAILABLE':
        return <InterruptedArt />
    }
  })()

  return (
    <div
      className={`viz-state ${ROLE[state]} flex flex-col items-center justify-center gap-3 rounded-lg px-6 py-8 text-center`}
      style={{ minHeight: `${minHeightPx}px` }}
      data-testid="visualization-state"
      data-state={state}
      // `polite` : l'état change rarement et ne doit pas interrompre la lecture.
      aria-live="polite"
      role="status"
    >
      {art}

      <div className="flex flex-col gap-1">
        {/* L'état est ÉCRIT : ni la couleur ni le mouvement ne le portent seuls. */}
        <p className="viz-state-label text-sm font-semibold">{LABEL[state]}</p>
        <p className="viz-state-text max-w-md text-xs leading-relaxed">{EXPLANATION[state]}</p>
        {reason ? <p className="viz-state-reason max-w-md text-xs leading-relaxed">{reason}</p> : null}
      </div>

      {state === 'UNAVAILABLE' && diagnosticHref ? (
        <a
          className="viz-action text-xs underline underline-offset-2"
          href={diagnosticHref}
          target="_blank"
          // `noreferrer` : l'URL d'Aigent ne part pas dans le Referer d'un tiers.
          rel="noreferrer noopener"
        >
          Vérifier la source
        </a>
      ) : null}
    </div>
  )
}
