/**
 * Surfaces du plan de contrôle — panneaux, cellules, et la forme de l'absence.
 *
 * Même raison d'être que `./type.tsx` : ces objets consomment les jetons
 * d'encre de `globals.css` là où le kit vendoré impose son `zinc`. Ils ne
 * remplacent pas `cockpit/primitives.tsx` — celui-ci reste le lieu des objets
 * MÉTIER (jauges, rails, `Fact`), tandis qu'ici on ne trouve que des contenants.
 *
 * L'ABSENCE EST UNE FORME, PAS UN TROU
 * ------------------------------------
 * Sur cet écran, la majorité des cellules sont vides tant que le backend n'est
 * pas joignable — neuf sur quatorze, mesuré sur la page réelle. Une absence
 * rendue comme un blanc donnerait un écran mort ; rendue comme un `0`, elle
 * mentirait. `Absent` lui donne donc une forme reconnaissable : un cadre en
 * pointillé, un mot, et rien qui ressemble à un chiffre.
 */
import type { ReactNode } from 'react'
import clsx from 'clsx'

/**
 * Un panneau — un contenant nommé.
 *
 * `bordered={false}` pour les panneaux qui vivent DANS une grille à filets
 * partagés : deux bordures adjacentes de 1 px en font une de 2 px, seul défaut
 * visible de ce genre d'assemblage.
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  className,
  bodyClassName,
  bordered = true,
}: Readonly<{
  title?: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  bordered?: boolean
}>) {
  return (
    <section
      className={clsx('flex min-w-0 flex-col bg-ink-800', bordered && 'border border-line', className)}
    >
      {title ? (
        <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3.5 py-2.5">
          <h2 className="truncate font-mono text-2xs tracking-[0.16em] text-fg uppercase">
            {title}
          </h2>
          {hint ? (
            <span className="ml-auto shrink-0 truncate text-xs text-fg-low">{hint}</span>
          ) : null}
          {actions ? <div className={clsx('shrink-0', !hint && 'ml-auto')}>{actions}</div> : null}
        </header>
      ) : null}
      <div className={clsx('min-w-0', bodyClassName)}>{children}</div>
    </section>
  )
}

/**
 * L'absence de mesure, rendue.
 *
 * Deux raisons, jamais confondues — c'est la règle de `AGENTS.md` § Vérité des
 * données, et elle vaut jusqu'au pixel :
 *  · `unread`  — la lecture a ÉCHOUÉ. On ne sait pas.
 *  · `no-data` — la lecture a RÉUSSI et il n'y avait rien. On sait qu'il n'y a rien.
 *
 * Les deux ne portent pas le même mot, parce qu'elles ne disent pas la même
 * chose. Un écran qui les rendrait à l'identique laisserait croire qu'un
 * backend mort est une flotte calme.
 */
export function Absent({
  reason = 'unread',
  label,
  className,
}: Readonly<{
  reason?: 'unread' | 'no-data'
  /** Mot non standard, quand le défaut ne dit pas juste (« non détectée »…). */
  label?: string
  className?: string
}>) {
  const word = label ?? (reason === 'unread' ? 'non lu' : 'aucune mesure')
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-2 border border-dashed border-line-hi px-2.5 py-1.5',
        'font-mono text-2xs tracking-[0.13em] text-fg-low uppercase',
        className,
      )}
      title={
        reason === 'unread'
          ? 'La lecture a échoué : cette valeur est inconnue, elle ne vaut pas zéro.'
          : 'La lecture a réussi et n’a rien rendu. C’est une mesure, pas une panne.'
      }
    >
      <span aria-hidden className="h-px w-3 bg-line-hi" />
      {word}
    </span>
  )
}

/**
 * Une cellule de décision — le rang qui appelle une action.
 *
 * Le liseré coloré n'apparaît QUE si la cellule demande vraiment quelque chose
 * (`live`). Le poser partout en ferait une décoration, et une décoration
 * colorée sur un écran d'instruments finit par être ignorée — y compris le
 * jour où elle signale un vrai blocage.
 */
export function DecisionCell({
  tone,
  live = false,
  children,
  className,
}: Readonly<{
  /** Couleur de sévérité en valeur CSS. */
  tone?: string
  live?: boolean
  children: ReactNode
  className?: string
}>) {
  return (
    <div
      className={clsx('relative overflow-hidden border border-line bg-ink-800 p-4', className)}
    >
      {live && tone ? (
        <span aria-hidden className="absolute inset-y-0 left-0 w-0.5" style={{ background: tone }} />
      ) : null}
      {children}
    </div>
  )
}

/**
 * La grille de contexte — des cellules séparées par un filet unique.
 *
 * Le filet vient du FOND de la grille et non des bordures des cellules : c'est
 * ce qui évite le trait double aux jonctions, sans avoir à retirer une bordure
 * sur deux selon la position.
 */
export function ContextGrid({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return (
    <div className={clsx('grid gap-px border border-line bg-line', className)}>{children}</div>
  )
}

/** Une cellule de la grille de contexte. */
export function ContextCell({
  children,
  className,
}: Readonly<{ children: ReactNode; className?: string }>) {
  return <div className={clsx('min-w-0 bg-ink-800 p-3.5', className)}>{children}</div>
}

/**
 * Une barre de proportion — la couverture d'une mesure, jamais une série.
 *
 * `ratio` est borné à [0,1] ici plutôt que chez l'appelant : une couverture
 * calculée sur des compteurs qui bougent peut dépasser 1 le temps d'un rendu,
 * et une barre qui déborde de sa piste est un défaut visible.
 */
export function Meter({
  ratio,
  tone,
  className,
}: Readonly<{ ratio: number; tone: string; className?: string }>) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100
  return (
    <div aria-hidden className={clsx('h-0.5 w-full bg-ink-600', className)}>
      <div className="h-full transition-[width]" style={{ width: `${pct}%`, background: tone }} />
    </div>
  )
}
