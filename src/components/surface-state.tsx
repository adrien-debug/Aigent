'use client'

/**
 * Les états d'une SURFACE PRODUIT — chargement, vide, non configuré,
 * indisponible, erreur.
 *
 * POURQUOI CE COMPOSANT EXISTE ALORS QUE `VisualizationStateView` EXISTE DÉJÀ.
 * Ce dernier décrit l'état d'un GRAPHIQUE : sa source, son cadre, son ratio. Un
 * écran produit n'a pas de ratio, pas de source unique, et son absence ne veut
 * pas dire la même chose — « la fenêtre de runs n'a pas pu être lue » n'est pas
 * « ce panneau Grafana ne répond pas ». Fusionner les deux ferait mentir les
 * deux. Ils partagent en revanche le MÊME VOCABULAIRE de mouvement, ce qui est
 * précisément le but : un opérateur reconnaît un état au geste, pas au module
 * qui l'a rendu.
 *
 * CE QUE CES ÉTATS NE FONT JAMAIS (règle reprise telle quelle du laboratoire) :
 * aucun pourcentage inventé, aucune barre de progression, aucune donnée
 * plausible, aucun shimmer générique. Les formes sont neutres, les textes
 * disent exactement ce qu'on sait. Un état « chargement » ne sert JAMAIS à
 * masquer une source indisponible.
 *
 * ACCESSIBILITÉ. L'état est écrit en toutes lettres et annoncé par `aria-live`.
 * Ni la couleur ni le mouvement ne portent d'information seuls. `useReducedMotion()`
 * bascule sur un rendu strictement statique : l'information reste entière.
 */
import { motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * Les cinq états qu'une surface produit peut rendre.
 *
 * `error` est distinct de `unavailable` à dessein : « la source n'a pas
 * répondu » est un fait sur le monde, « le rendu a levé » est un fait sur nous.
 * Un opérateur n'agit pas pareil dans les deux cas.
 */
export type SurfaceStateKind = 'loading' | 'empty' | 'not-configured' | 'unavailable' | 'error'

const LABEL: Record<SurfaceStateKind, string> = {
  loading: 'Chargement',
  empty: 'Rien à afficher',
  'not-configured': 'Surface non configurée',
  unavailable: 'Lecture impossible',
  error: 'Erreur de rendu',
}

/**
 * `loading` — une architecture fantôme qui se compose.
 *
 * Largeurs FIXES : rien d'aléatoire, rien qui ressemble à une donnée. Elles
 * apparaissent en cascade pour dire « ça arrive », jamais « voici à quoi ça
 * ressemblera ».
 */
function LoadingArt({ animate }: Readonly<{ animate: boolean }>) {
  const bars = [46, 72, 58]
  return (
    <div className="flex w-full max-w-sm flex-col gap-2" aria-hidden="true">
      {bars.map((width, i) => (
        <motion.div
          key={width}
          className="h-2 rounded-full"
          style={{ width: `${width}%`, backgroundColor: 'var(--aig-line)' }}
          initial={animate ? { opacity: 0.3 } : false}
          animate={animate ? { opacity: [0.3, 0.55, 0.3] } : undefined}
          transition={
            animate
              ? {
                  duration: 2.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * 0.18,
                }
              : undefined
          }
        />
      ))}
    </div>
  )
}

/** `empty` — l'architecture calme d'une zone qui EXISTE mais ne porte rien. */
function EmptyArt() {
  return (
    <svg
      viewBox="0 0 120 60"
      className="h-16 w-40"
      fill="none"
      stroke="var(--aig-line)"
      aria-hidden="true"
    >
      <line x1="10" y1="50" x2="112" y2="50" strokeWidth="1" />
      <line x1="10" y1="6" x2="10" y2="50" strokeWidth="1" />
      {[18, 30, 42].map((y) => (
        <line key={y} x1="10" y1={y} x2="112" y2={y} strokeWidth="0.5" strokeDasharray="2 4" />
      ))}
    </svg>
  )
}

/** `not-configured` — un blueprint : le branchement MANQUE, il n'est pas cassé. */
function BlueprintArt() {
  return (
    <svg
      viewBox="0 0 120 60"
      className="h-16 w-40"
      fill="none"
      stroke="var(--aig-line)"
      aria-hidden="true"
    >
      <rect x="10" y="12" width="38" height="36" rx="3" strokeWidth="1" strokeDasharray="3 3" />
      <rect x="72" y="12" width="38" height="36" rx="3" strokeWidth="1" strokeDasharray="3 3" />
      <line x1="48" y1="30" x2="72" y2="30" strokeWidth="1" strokeDasharray="3 3" />
    </svg>
  )
}

/** `unavailable` / `error` — un flux interrompu. La rupture est explicite. */
function InterruptedArt() {
  return (
    <svg
      viewBox="0 0 120 60"
      className="h-16 w-40"
      fill="none"
      stroke="var(--aig-accent)"
      aria-hidden="true"
    >
      <line x1="10" y1="30" x2="48" y2="30" strokeWidth="1.5" />
      <line x1="72" y1="30" x2="110" y2="30" strokeWidth="1.5" />
      <line x1="53" y1="20" x2="67" y2="40" strokeWidth="1.5" />
      <line x1="67" y1="20" x2="53" y2="40" strokeWidth="1.5" />
    </svg>
  )
}

function Art({ kind, animate }: Readonly<{ kind: SurfaceStateKind; animate: boolean }>) {
  switch (kind) {
    case 'loading':
      return <LoadingArt animate={animate} />
    case 'empty':
      return <EmptyArt />
    case 'not-configured':
      return <BlueprintArt />
    default:
      return <InterruptedArt />
  }
}

export default function SurfaceState({
  kind,
  detail,
  action,
  minHeightPx = 260,
}: Readonly<{
  kind: SurfaceStateKind
  /** Ce qu'on sait, en clair. Jamais un secret, jamais une pile d'appels. */
  detail?: string | null
  /** Action sûre proposée à l'opérateur (lecture seule). Jamais un bouton inerte. */
  action?: ReactNode
  minHeightPx?: number
}>) {
  // `useReducedMotion()` renvoie `null` avant hydratation : le `=== true` évite
  // de traiter « pas encore connu » comme « animation demandée ».
  const reduced = useReducedMotion()
  const animate = reduced !== true

  return (
    <div
      className="flex flex-col items-center justify-center gap-4 px-6 py-10 text-center"
      style={{ minHeight: `${minHeightPx}px` }}
      role="status"
      aria-live="polite"
    >
      <Art kind={kind} animate={animate} />

      <div className="flex flex-col gap-1.5">
        {/* L'état en toutes lettres — ce que ni la couleur ni le mouvement ne
            peuvent porter seuls. */}
        <p className="text-sm font-medium">{LABEL[kind]}</p>
        {detail ? <p className="aig-text-muted max-w-md text-sm">{detail}</p> : null}
      </div>

      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  )
}
