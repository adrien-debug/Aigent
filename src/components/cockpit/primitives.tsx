/**
 * Primitives du cockpit — le vocabulaire VISUEL PROPRE AU MÉTIER, au-dessus de
 * Catalyst (`src/components/ui/`), qui reste l'unique design system du
 * produit (décision produit du 2026-07-31, voir
 * `docs/cockpit-catalyst-migration.md`).
 *
 * Ce que ce fichier NE fait plus : boutons, badges, avatars génériques —
 * Catalyst les fournit, on les consomme directement (`Avatar`, `Badge`,
 * `Divider`, `TextLink`). Ce qui reste ici est ce que Catalyst ne fournit
 * pas : panneau borné en hauteur, état d'absence de mesure, diode d'état,
 * rail de sévérité, jauges de proportion, composition de ligne d'entité.
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
import { Avatar } from '@/components/ui/avatar'
import { Divider } from '@/components/ui/divider'

/* ────────────────────────────── Surfaces ────────────────────────────── */

/**
 * En-tête de panneau — tiret d'accent, titre en capitales serrées, mesure ou
 * action à droite, `Divider` Catalyst en pied. Extrait de `Panel` pour rester
 * réutilisable par un panneau dont le corps ne suit pas la mise en page par
 * défaut (ex. `ActionQueue`).
 */
export function PanelHeader({
  title,
  hint,
  actions,
  className,
}: {
  title: string
  hint?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={clsx('shrink-0', className)}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span aria-hidden className="h-3 w-0.5 shrink-0 rounded-full bg-accent" />
        <h2 className="shrink-0 text-[10px] font-semibold tracking-[0.2em] whitespace-nowrap text-ink-dim uppercase">
          {title}
        </h2>
        {hint ? (
          <span className="ml-auto truncate font-mono text-[10px] tracking-tight text-ink-faint">
            {hint}
          </span>
        ) : null}
        {actions ? <div className={clsx('shrink-0', hint ? 'ml-2' : 'ml-auto')}>{actions}</div> : null}
      </div>
      <Divider className="border-white/5" />
    </header>
  )
}

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
      <PanelHeader title={title} hint={hint} actions={actions} />
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

/* ─────────────────────────────── Entités ───────────────────────────────── */

/**
 * Monogramme d'identité — enveloppe métier minimale autour de `Avatar`
 * Catalyst (`square`, `initials`) : la seule chose que Catalyst ne porte pas
 * nativement est l'état actif/inactif du cockpit.
 *
 * `active` porte l'UNIQUE signal de statut de l'avatar (teinte accent vs
 * neutre) : pas de ring ni de pulse en plus, le rail de la ligne et le
 * libellé texte suffisent à confirmer l'état.
 */
export function EntityAvatar({
  initials,
  active = false,
  className,
}: {
  initials: string
  active?: boolean
  className?: string
}) {
  return (
    <Avatar
      square
      initials={initials}
      className={clsx(
        // `bg-*`/`text-*`/`border-*` : aucun conflit d'utilitaire avec les
        // classes de base d'`Avatar` (qui pose un `outline`, pas un `border`,
        // et ni fond ni couleur de texte) — composition normale, pas de
        // combat de spécificité.
        'size-7 shrink-0 border font-mono text-[10px] font-semibold',
        active ? 'border-accent/25 bg-accent/10 text-accent' : 'border-white/8 bg-elevated text-ink-faint',
        className,
      )}
    />
  )
}

/** Deux lettres d'identité — jamais un nom inventé, seulement son abréviation. */
export function initialsOf(name: string | null): string {
  if (!name) return '··'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Valeur monospacée alignée-données, ou la marque d'absence — jamais un zéro de remplacement. */
export function MetricValue({
  value,
  unit,
  size = 'md',
}: {
  value: string | number | null
  unit?: string
  size?: 'sm' | 'md'
}) {
  if (value === null) return <AbsentMark />
  return (
    <span className="flex items-baseline gap-1">
      <span
        className={clsx(
          'font-mono leading-none font-semibold tabular-nums text-ink',
          size === 'md' ? 'text-[14px]' : 'text-[11px] font-normal text-ink-dim',
        )}
      >
        {value}
      </span>
      {unit ? <span className="text-[9.5px] text-ink-faint">{unit}</span> : null}
    </span>
  )
}

/** Marque d'absence inline — même orthographe que `Unavailable`, pour une valeur seule. */
export function AbsentMark() {
  return (
    <span className="font-mono text-[9px] tracking-wide text-ink-faint uppercase">
      {UNAVAILABLE_LABEL}
    </span>
  )
}

/** Séparateur ponctuel entre deux mesures alignées à droite d'une ligne. */
export function MetricDot() {
  return (
    <span aria-hidden className="text-ink-faint/50">
      ·
    </span>
  )
}

/**
 * Ligne d'entité — grammaire commune à un agent, un projet ou un run : rail de
 * statut sur l'arête gauche, avatar, identité (titre + sous-titre), mesures
 * alignées à droite. Une seule implémentation pour les trois rosters de
 * l'écran ; ce que chaque domaine affiche à droite reste à l'appelant.
 */
export function EntityRow({
  railColor,
  avatar,
  title,
  titleMeta,
  subtitle,
  metrics,
  href,
}: {
  railColor: string
  avatar: ReactNode
  title: ReactNode
  /** Signal court à côté du titre — un point d'état, jamais plus d'un. */
  titleMeta?: ReactNode
  subtitle: ReactNode
  metrics: ReactNode
  href?: string
}) {
  const Tag = href ? 'a' : 'div'
  return (
    <li className="group relative border-b border-white/[0.035] transition-colors hover:bg-elevated">
      <Rail color={railColor} className="opacity-60 transition-opacity group-hover:opacity-100" />
      <Tag {...(href ? { href } : {})} className="flex items-center gap-2.5 px-3.5 py-2.5">
        {avatar}
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-ink">{title}</span>
            {titleMeta}
          </span>
          <span className="truncate text-[10.5px] text-ink-faint">{subtitle}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">{metrics}</span>
      </Tag>
    </li>
  )
}
