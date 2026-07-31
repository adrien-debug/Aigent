/**
 * Composants MÉTIER du cockpit — ce que Catalyst ne fournit pas.
 *
 * Le kit (`src/components/ui/`) est disponible comme outil ; il ne se
 * modifie pas à la légère (gate `check:ui-kit-integrity`). Ce fichier ne
 * contient donc AUCUN équivalent de primitive du kit : ni badge, ni avatar, ni
 * bouton, ni texte, ni séparateur, ni surface générique. Uniquement des objets
 * que le kit n'a pas :
 *
 *  · `Panel`        — surface à hauteur BORNÉE par la grille du cockpit ;
 *                     c'est ce qui tient le zéro-scroll (le kit n'a pas de
 *                     notion de carte qui ne grandit pas avec sa donnée).
 *  · `Unavailable`  — l'absence de mesure comme état de premier rang, avec la
 *                     distinction « lecture échouée » / « rien à mesurer »
 *                     (AGENTS.md § Vérité des données).
 *  · `Led`          — témoin d'activité temps réel.
 *  · `Rail`         — barre de sévérité en tête de ligne.
 *  · jauges         — proportions bornées (n sur total), pas des séries.
 *
 * Aucun mini-graphique inline dans les cartes ou les tables : les seuls objets
 * graphiques ici encodent une proportion qui existe réellement.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/* ────────────────────────────── Surfaces ────────────────────────────── */

/**
 * Panneau à hauteur bornée — le seul composant structurel du cockpit.
 *
 * Son en-tête est composé de Catalyst (`Subheading`, `Text`, `Divider`) ; ce
 * que le panneau ajoute est le contrat de hauteur : il ne grandit jamais avec
 * la donnée, c'est la donnée qui défile à l'intérieur.
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  padded = true,
}: {
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  /** Contrainte de hauteur imposée par la grille du cockpit. */
  className?: string
  bodyClassName?: string
  /** `false` quand le contenu gère lui-même ses marges (table, liste pleine largeur). */
  padded?: boolean
}) {
  return (
    <section
      className={clsx(
        'flex min-h-0 flex-col overflow-hidden rounded-lg',
        'bg-white shadow-xs ring-1 ring-zinc-950/5 dark:bg-zinc-900 dark:ring-white/10',
        className,
      )}
    >
      <header className="shrink-0">
        <div className="flex items-center gap-3 px-4 py-3">
          <Subheading level={2} className="shrink-0 truncate">
            {title}
          </Subheading>
          {hint ? <Text className="ml-auto shrink-0 truncate">{hint}</Text> : null}
          {actions ? <div className={clsx('shrink-0', hint ? 'ml-3' : 'ml-auto')}>{actions}</div> : null}
        </div>
        <Divider soft />
      </header>
      <div className={clsx('min-h-0 flex-1', padded && 'p-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/* ───────────────────────────── Absence ─────────────────────────────── */

/**
 * Absence de mesure. Deux raisons distinctes, jamais confondues :
 *  · `reason="unread"`  — la lecture a échoué (backend muet).
 *  · `reason="no-data"` — la lecture a réussi, il n'y avait rien à mesurer.
 */
export function Unavailable({
  reason = 'unread',
  detail,
  compact = false,
}: {
  reason?: 'unread' | 'no-data'
  detail?: string
  compact?: boolean
}) {
  const label = reason === 'unread' ? UNAVAILABLE_LABEL : 'Aucune mesure'
  return (
    <div
      className={clsx(
        'flex h-full flex-col items-center justify-center gap-2 rounded-lg',
        'border border-dashed border-zinc-950/10 dark:border-white/10',
        compact ? 'px-2 py-1' : 'p-4',
      )}
    >
      <span
        className={clsx(
          'rounded-md bg-zinc-950/5 font-medium text-zinc-500 uppercase dark:bg-white/5 dark:text-zinc-400',
          compact ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        )}
      >
        {label}
      </span>
      {detail && !compact ? <Text className="max-w-[34ch] text-center">{detail}</Text> : null}
    </div>
  )
}

/** Marque d'absence inline — pour une valeur seule dans une cellule. */
export function AbsentMark() {
  return <span className="text-xs text-zinc-500 uppercase dark:text-zinc-400">{UNAVAILABLE_LABEL}</span>
}

/* ─────────────────────────── Objets d'instrument ─────────────────────── */

/**
 * Témoin lumineux. `live` fait battre la diode — réservé à ce qui est
 * réellement en vol, jamais posé pour décorer.
 */
export function Led({
  color,
  live = false,
  className,
}: {
  color: string
  live?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={clsx('size-1.5 shrink-0 rounded-full', live && 'pulse-live', className)}
      style={{ background: color }}
    />
  )
}

/** Rail de sévérité — la barre verticale colorée qui ouvre une ligne de liste. */
export function Rail({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={clsx('absolute inset-y-0 left-0 w-0.5', className)}
      style={{ background: color }}
    />
  )
}

/**
 * Mètre segmenté — `filled` sur `total`. Un cran allumé = une unité réelle.
 * Au-delà de 24 unités le comptage cesse d'être lisible et l'on retombe sur une
 * barre continue, qui dit la même proportion sans mentir sur la granularité.
 */
export function SegmentMeter({
  filled,
  total,
  color,
  className,
}: {
  filled: number
  total: number
  color: string
  className?: string
}) {
  const safeTotal = Math.max(total, 0)
  const safeFilled = Math.min(Math.max(filled, 0), safeTotal)

  if (safeTotal === 0) {
    return <div className={clsx('h-1.5 w-full rounded-full bg-zinc-950/5 dark:bg-white/10', className)} />
  }

  if (safeTotal > 24) {
    return <BarMeter ratio={safeFilled / safeTotal} color={color} className={className} />
  }

  return (
    <div aria-hidden className={clsx('flex items-end gap-[2px]', className)}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span
          key={i}
          className="h-3.5 w-[3px] rounded-[1px]"
          style={i < safeFilled ? { background: color } : { background: 'rgb(161 161 170 / 0.35)' }}
        />
      ))}
    </div>
  )
}

/** Barre de proportion bornée 0..1 — la couverture d'une mesure, pas une série. */
export function BarMeter({
  ratio,
  color,
  className,
}: {
  ratio: number
  color: string
  className?: string
}) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100
  return (
    <div
      aria-hidden
      className={clsx(
        'h-1.5 w-full overflow-hidden rounded-full bg-zinc-950/5 dark:bg-white/10',
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

/**
 * Jauge d'arc — un ratio borné 0..1, et rien d'autre. Elle n'apparaît que
 * lorsque la valeur EST mesurée : une jauge à zéro sur une donnée absente est
 * précisément le mensonge que cet écran refuse.
 */
export function ArcGauge({
  ratio,
  color,
  size = 44,
  label,
}: {
  ratio: number
  color: string
  size?: number
  label?: string
}) {
  const stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(Math.max(ratio, 0), 1)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgb(161 161 170 / 0.3)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * clamped} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}

/** Deux lettres d'identité — jamais un nom inventé, seulement son abréviation. */
export function initialsOf(name: string | null): string {
  if (!name) return '··'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}
