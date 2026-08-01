'use client'

/**
 * Garde de mouvement globale — `prefers-reduced-motion` respecté par défaut.
 *
 * POURQUOI UN PROVIDER PLUTÔT QU'UNE GARDE PAR COMPOSANT. L'audit du 2026-08-02
 * a compté 26 animations Motion dans le produit et 8 gardées : 18 tournaient
 * quel que soit le réglage système. Ce n'est pas un oubli ponctuel, c'est le
 * mode de défaillance NATUREL de la garde manuelle — chaque nouveau composant
 * animé doit y penser, et un jour quelqu'un n'y pense pas.
 *
 * `reducedMotion="user"` inverse la charge de la preuve : Motion lit la
 * préférence système et neutralise transform et layout pour TOUT ce qui est
 * rendu sous ce provider, y compris les animations écrites demain. Opacité et
 * couleur restent animées — ce sont les seules transitions que les
 * recommandations vestibulaires laissent passer, et les supprimer ferait
 * apparaître les états sans transition aucune.
 *
 * CE QUE CE PROVIDER NE COUVRE PAS, ET QUI RESTE À GARDER À LA MAIN :
 *
 *  · Les composants `@motionplus/core` (`Carousel`, `Cursor`, `AnimateNumber`).
 *    Vérifié dans `node_modules` : aucun fichier de leur `dist/es/components/`
 *    ne lit `reducedMotion` ni `prefers-reduced`. Ils n'héritent donc PAS de ce
 *    contexte et demandent une garde explicite là où ils sont montés.
 *  · Les boucles `repeat: Infinity` de grande amplitude. `reducedMotion="user"`
 *    neutralise le transform, mais une boucle infinie sur une propriété
 *    autorisée (opacité, `clipPath`) continuerait de tourner. Elles portent
 *    donc chacune leur `useReducedMotion()` — voir `surface-state.tsx`,
 *    `visualization-state.tsx` et `pattern-progress.tsx`.
 *
 * Les media queries CSS ne remplacent PAS ce provider : elles ne surchargent
 * que `animation-*` et `transition-duration`, alors que Motion écrit
 * `transform` et `opacity` en style inline via WAAPI/rAF. Une règle
 * `@media (prefers-reduced-motion)` est un no-op sur un `motion.div` — c'est
 * précisément pourquoi la garde doit vivre dans Motion lui-même.
 */
import { MotionConfig } from 'motion/react'
import type { ReactNode } from 'react'

export default function MotionProvider({ children }: Readonly<{ children: ReactNode }>) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>
}
