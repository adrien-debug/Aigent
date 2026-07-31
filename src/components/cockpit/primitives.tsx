/**
 * Composants MÉTIER du cockpit — ce que Catalyst ne fournit pas.
 *
 * Le kit (`src/components/ui/`) est disponible comme outil ; il ne se
 * modifie pas à la légère (gate `check:ui-kit-integrity`). Ce fichier ne
 * contient donc AUCUN équivalent de primitive du kit : ni badge, ni avatar, ni
 * bouton, ni texte, ni séparateur, ni surface générique. Uniquement des objets
 * que le kit n'a pas :
 *
 *  · `Panel`        — section avec en-tête Catalyst ; le corps suit la hauteur
 *                     réelle du contenu. `scrollable` borne le corps si un
 *                     scroll interne améliore l'usage.
 *  · `Unavailable`  — l'absence de mesure comme état de premier rang, avec la
 *                     distinction « lecture échouée » / « rien à mesurer »
 *                     (AGENTS.md § Vérité des données).
 *  · `Led`          — témoin d'activité temps réel.
 *  · `Rail`         — barre de sévérité en tête de ligne.
 *  · jauges         — proportions bornées (n sur total), pas des séries.
 *  · `SEVERITY`     — la palette de couleur d'un `Rail`, source unique.
 *  · `Fact`/`FactValue`/`NotMeasured` — paire libellé/valeur, absence rendue.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Divider } from '@/components/ui/divider'
import { Subheading } from '@/components/ui/heading'
import { Strong, Text } from '@/components/ui/text'
import { UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'

/* ────────────────────────────── Surfaces ────────────────────────────── */

/**
 * Section avec en-tête — composant structurel métier (header Catalyst + corps).
 *
 * Le corps grandit avec son contenu par défaut. Passer `scrollable` pour borner
 * la hauteur et défiler à l'intérieur quand c'est utile (liste longue dans une
 * zone sticky, etc.).
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  padded = true,
  scrollable = false,
}: Readonly<{
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  /** `false` quand le contenu gère lui-même ses marges (table, liste pleine largeur). */
  padded?: boolean
  /** Corps borné avec scroll interne — opt-in, pas le défaut. */
  scrollable?: boolean
}>) {
  const actionsClass = hint ? 'ml-3' : 'ml-auto'

  return (
    <section
      className={clsx(
        'flex flex-col rounded-lg',
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
          {actions ? (
            <div className={clsx('shrink-0', actionsClass)}>{actions}</div>
          ) : null}
        </div>
        <Divider soft />
      </header>
      <div
        className={clsx(
          padded && 'p-4',
          scrollable && 'scroll-thin min-h-0 overflow-y-auto',
          bodyClassName,
        )}
      >
        {children}
      </div>
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
}: Readonly<{
  reason?: 'unread' | 'no-data'
  detail?: string
  compact?: boolean
}>) {
  const label = reason === 'unread' ? UNAVAILABLE_LABEL : 'Aucune mesure'
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-2 rounded-lg',
        'border border-dashed border-zinc-950/10 dark:border-white/10',
        compact ? 'px-2 py-1' : 'min-h-32 p-4',
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

/**
 * Une valeur non mesurée, en ligne. Jamais un `0` à la place.
 *
 * Anciennement redéclaré à l'identique dans `runtime/atoms.tsx` et
 * `delivery/atoms.tsx` : même classe, même contrat, deux copies qui ne
 * pouvaient dériver qu'en silence l'une de l'autre.
 */
export function NotMeasured({ why }: Readonly<{ why?: string }>) {
  return (
    <span
      className="text-xs text-zinc-500 uppercase dark:text-zinc-400"
      title={why ?? 'Cette valeur n’a pas été mesurée — elle n’est pas nulle, elle est absente.'}
    >
      {UNAVAILABLE_LABEL}
    </span>
  )
}

/**
 * Une paire libellé / valeur. `value === null` rend `NotMeasured` : la garde
 * est dans la fonction, donc aucun appelant ne peut l'oublier. Un `0` mesuré
 * reste un `0` — seul `null` est une absence.
 */
export function Fact({
  label,
  value,
  why,
  hint,
}: Readonly<{
  label: string
  value: ReactNode | null
  why?: string
  hint?: string
}>) {
  return (
    <div className="min-w-0">
      <Text className="truncate text-xs">{label}</Text>
      <div className="mt-0.5 min-w-0 truncate">
        {value === null ? <NotMeasured why={why} /> : value}
      </div>
      {hint ? <Text className="mt-0.5 truncate text-xs">{hint}</Text> : null}
    </div>
  )
}

/** Une valeur mise en avant dans un `Fact`. */
export function FactValue({ children }: Readonly<{ children: ReactNode }>) {
  return <Strong className="tabular-nums">{children}</Strong>
}

/* ─────────────────────────── Objets d'instrument ─────────────────────── */

/**
 * Palette sémantique d'un `Rail` — quatre teintes, et rien d'autre.
 *
 * Anciennement redéclarée indépendamment (mêmes valeurs hex, parfois une
 * légère dérive comme `#3b82f6` vs `#3b9dd6` pour « en cours ») dans
 * `agents/roster-screen.tsx`, `qualification/roster-screen.tsx`,
 * `runs/run-list.tsx`, `delivery/roster-screen.tsx`, `projects/{list,detail}-screen.tsx`,
 * `builder/select-screen.tsx` et `cockpit/rows.tsx`. Une seule source : le sens
 * (succès/échec/attention/neutre) ne doit pas pouvoir diverger d'un écran à
 * l'autre pour le même statut.
 */
export const SEVERITY = {
  good: '#0da87f',
  bad: '#e8455f',
  warn: '#be850f',
  running: '#3b82f6',
  muted: 'rgb(161 161 170 / 0.35)',
} as const

/**
 * Témoin lumineux. `live` fait battre la diode — réservé à ce qui est
 * réellement en vol, jamais posé pour décorer.
 */
export function Led({
  color,
  live = false,
  className,
}: Readonly<{
  color: string
  live?: boolean
  className?: string
}>) {
  return (
    <span
      aria-hidden
      className={clsx('size-1.5 shrink-0 rounded-full', live && 'pulse-live', className)}
      style={{ background: color }}
    />
  )
}

/** Rail de sévérité — la barre verticale colorée qui ouvre une ligne de liste. */
export function Rail({ color, className }: Readonly<{ color: string; className?: string }>) {
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
}: Readonly<{
  filled: number
  total: number
  color: string
  className?: string
}>) {
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
}: Readonly<{
  ratio: number
  color: string
  className?: string
}>) {
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
}: Readonly<{
  ratio: number
  color: string
  size?: number
  label?: string
}>) {
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
