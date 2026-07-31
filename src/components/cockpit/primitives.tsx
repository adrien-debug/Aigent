/**
 * Primitives du cockpit — le vocabulaire visuel de l'écran, et rien d'autre.
 *
 * Ce fichier ne dépend plus du kit Catalyst : le cockpit avait fini par
 * réécrire chaque composant du kit à coups de `!important` (`!text-xs`,
 * `!text-zinc-500`…), ce qui n'est pas de la réutilisation mais de la lutte. Le
 * vocabulaire ci-dessous est court, il porte la direction sombre, et il est le
 * seul endroit où l'on décide à quoi ressemble une surface.
 *
 * Deux règles structurantes, héritées et maintenues :
 *  · Une box a une hauteur BORNÉE par la grille et ne grandit jamais avec la
 *    donnée — c'est la donnée qui scrolle dedans.
 *  · `Unavailable` est un état de premier rang, pas un fallback discret. Une
 *    mesure absente se DIT ; elle ne se peint pas en zéro.
 *
 * Aucun mini-graphique inline dans les cartes ou les tables. Les seuls objets
 * graphiques ici — jauge d'arc, mètre segmenté — encodent une PROPORTION bornée
 * qui existe réellement (n sur total), jamais une série temporelle miniature.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/* ────────────────────────────── Surfaces ────────────────────────────── */

/**
 * Cadre de panneau — le niveau « raised » de l'échelle de profondeur.
 *
 * L'en-tête est une barre d'instrument : un tiret d'accent, un titre en
 * capitales serrées, et une mesure à droite en chiffres monospacés.
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
}: {
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  /** Contrainte de hauteur imposée par la grille du cockpit. */
  className?: string
  bodyClassName?: string
}) {
  return (
    <section
      className={clsx(
        'lip elev relative flex min-h-0 flex-col overflow-hidden rounded-xl',
        'border border-white/6 bg-raised',
        className,
      )}
    >
      <header className="flex shrink-0 items-center gap-2.5 border-b border-white/5 px-3.5 py-2.5">
        <span
          aria-hidden
          className="h-3 w-0.5 shrink-0 rounded-full bg-accent"
        />
        <h2 className="shrink-0 text-[10px] font-semibold tracking-[0.2em] whitespace-nowrap text-ink-dim uppercase">
          {title}
        </h2>
        {hint ? (
          <span className="ml-auto truncate font-mono text-[10px] tracking-tight text-ink-faint">
            {hint}
          </span>
        ) : null}
        {actions ? <div className={clsx('shrink-0', hint ? 'ml-2' : 'ml-auto')}>{actions}</div> : null}
      </header>
      <div className={clsx('min-h-0 flex-1', bodyClassName ?? 'p-3')}>{children}</div>
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
        'hatched flex h-full flex-col items-center justify-center gap-2 rounded-lg',
        'border border-dashed border-white/8',
        compact ? 'px-2 py-1' : 'p-4',
      )}
    >
      <span
        className={clsx(
          'rounded border border-white/10 bg-overlay/60 font-mono tracking-[0.16em] text-ink-faint uppercase',
          compact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]',
        )}
      >
        {label}
      </span>
      {detail && !compact ? (
        <p className="max-w-[34ch] text-center text-[11px] leading-snug text-ink-faint">{detail}</p>
      ) : null}
    </div>
  )
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
    return <div className={clsx('h-1.5 w-full rounded-full bg-white/6', className)} />
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
          style={
            i < safeFilled
              ? { background: color }
              : { background: 'rgb(255 255 255 / 0.08)' }
          }
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
    <div aria-hidden className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-white/8', className)}>
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
        stroke="rgb(255 255 255 / 0.08)"
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

/**
 * Pastille d'état — un libellé court, éventuellement précédé d'une diode. Elle
 * porte TOUJOURS son texte : la couleur ne suffit jamais à identifier un état.
 */
export function Chip({
  children,
  color,
  live = false,
  className,
}: {
  children: ReactNode
  color?: string
  live?: boolean
  className?: string
}) {
  return (
    <span
      className={clsx(
        'inline-flex shrink-0 items-center gap-1.5 rounded border border-white/8 bg-elevated px-1.5 py-0.5',
        'font-mono text-[9.5px] tracking-[0.12em] whitespace-nowrap text-ink-dim uppercase',
        className,
      )}
    >
      {color ? <Led color={color} live={live} /> : null}
      {children}
    </span>
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
