// Couleurs issues des jetons `--aig-*` (voir `src/app/globals.css`). Les
// variantes `dark:` ont disparu : les jetons sont déjà sombres, une paire
// `X dark:Y` se réduit donc à une seule valeur.
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function CheckboxGroup({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return (
    <div
      data-slot="control"
      {...props}
      className={clsx(
        className,
        // Basic groups
        'space-y-3',
        // With descriptions
        'has-data-[slot=description]:space-y-6 has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

export function CheckboxField({
  className,
  ...props
}: Readonly<{ className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>>) {
  return (
    <Headless.Field
      data-slot="field"
      {...props}
      className={clsx(
        className,
        // Base layout
        'grid grid-cols-[1.125rem_1fr] gap-x-4 gap-y-1 sm:grid-cols-[1rem_1fr]',
        // Control layout
        '*:data-[slot=control]:col-start-1 *:data-[slot=control]:row-start-1 *:data-[slot=control]:mt-0.75 sm:*:data-[slot=control]:mt-1',
        // Label layout
        '*:data-[slot=label]:col-start-2 *:data-[slot=label]:row-start-1',
        // Description layout
        '*:data-[slot=description]:col-start-2 *:data-[slot=description]:row-start-2',
        // With description
        'has-data-[slot=description]:**:data-[slot=label]:font-medium'
      )}
    />
  )
}

const base = [
  // Basic layout
  'relative isolate flex size-4.5 items-center justify-center rounded-[0.3125rem] sm:size-4',
  // Le pseudo `before` ne servait qu'au mode clair (il etait deja masque en
  // sombre). Dark-first : il reste masque, le controle porte le fond.
  'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(0.3125rem-1px)] before:hidden',
  // Background color applied to control
  'bg-(--aig-line-soft) group-data-checked:bg-(--checkbox-checked-bg)',
  // Border
  'border border-(--aig-line) group-data-checked:border-(--checkbox-checked-border) group-data-hover:group-data-checked:border-(--checkbox-checked-border) group-data-hover:border-(--aig-line)',
  // Inner highlight shadow
  'after:absolute after:-inset-px after:hidden after:rounded-[0.3125rem] after:shadow-[inset_0_1px_var(--aig-line-soft)] group-data-checked:after:block',
  // Focus ring
  'group-data-focus:outline-2 group-data-focus:outline-offset-2 group-data-focus:outline-(--aig-accent)',
  // Disabled state
  'group-data-disabled:opacity-50',
  'group-data-disabled:border-(--aig-line) group-data-disabled:bg-(--aig-subtle) group-data-disabled:[--checkbox-check:var(--aig-text-faint)] group-data-disabled:before:bg-transparent',
  'group-data-checked:group-data-disabled:after:hidden',
  // Forced colors mode
  'forced-colors:[--checkbox-check:HighlightText] forced-colors:[--checkbox-checked-bg:Highlight] forced-colors:group-data-disabled:[--checkbox-check:Highlight]',
]

/*
 * Chaque variante decrit une case COCHEE : un fond franc, une bordure de meme
 * famille et une coche lisible dessus. Decochee, la case reste sur
 * `--aig-line-soft` (defini dans `base`) — l'ecart de clarte entre les deux est
 * ce qui rend l'etat lisible sans couleur.
 *
 * Le vocabulaire du produit tient en deux registres : l'accent cuivre (choix
 * neutre, par defaut) et la severite (bon / en cours / avertissement / bloque /
 * mauvais). Les noms de teintes Tailwind sont conserves comme CLES d'API pour ne
 * pas casser les appelants, mais ils pointent tous vers un jeton `--aig-*` : le
 * produit n'a pas vingt couleurs, il en a six.
 */
const ACCENT =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-accent)] [--checkbox-checked-border:var(--aig-accent)]'
const NEUTRAL =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-text)] [--checkbox-checked-border:var(--aig-text)]'
const GOOD =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-severity-good)] [--checkbox-checked-border:var(--aig-severity-good)]'
const RUNNING =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-severity-running)] [--checkbox-checked-border:var(--aig-severity-running)]'
const WARN =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-severity-warn)] [--checkbox-checked-border:var(--aig-severity-warn)]'
const BLOCKED =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-severity-blocked)] [--checkbox-checked-border:var(--aig-severity-blocked)]'
const BAD =
  '[--checkbox-check:var(--aig-base)] [--checkbox-checked-bg:var(--aig-severity-bad)] [--checkbox-checked-border:var(--aig-severity-bad)]'

const colors = {
  'dark/zinc': ACCENT,
  'dark/white': NEUTRAL,
  white: NEUTRAL,
  dark: ACCENT,
  zinc: NEUTRAL,
  red: BAD,
  orange: WARN,
  amber: WARN,
  yellow: WARN,
  lime: GOOD,
  green: GOOD,
  emerald: GOOD,
  teal: GOOD,
  cyan: RUNNING,
  sky: RUNNING,
  blue: RUNNING,
  indigo: RUNNING,
  violet: BLOCKED,
  purple: BLOCKED,
  fuchsia: BLOCKED,
  pink: ACCENT,
  rose: BAD,
}

type Color = keyof typeof colors

export function Checkbox({
  color = 'dark/zinc',
  className,
  ...props
}: Readonly<{
  color?: Color
  className?: string
} & Omit<Headless.CheckboxProps, 'as' | 'className'>>) {
  return (
    <Headless.Checkbox
      data-slot="control"
      {...props}
      className={clsx(className, 'group inline-flex focus:outline-hidden')}
    >
      <span className={clsx([base, colors[color]])}>
        <svg
          className="size-4 stroke-(--checkbox-check) opacity-0 group-data-checked:opacity-100 sm:h-3.5 sm:w-3.5"
          viewBox="0 0 14 14"
          fill="none"
        >
          {/* Checkmark icon */}
          <path
            className="opacity-100 group-data-indeterminate:opacity-0"
            d="M3 8L6 11L11 3.5"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Indeterminate icon */}
          <path
            className="opacity-0 group-data-indeterminate:opacity-100"
            d="M3 7H11"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </Headless.Checkbox>
  )
}
