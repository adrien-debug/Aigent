/*
 * Couleurs : jetons `--aig-*` uniquement (voir `src/app/globals.css`).
 * Les variantes `dark:` du kit Catalyst ont disparu — les jetons sont déjà
 * sombres, donc chaque paire `clair dark:sombre` se réduit à une seule valeur.
 * L'anneau de focus reste présent, porté par `--aig-accent`. Structure,
 * variantes, tailles, `data-*` et `forced-colors:*` sont inchangés.
 */
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { Link } from './link'

// Palette solide : un fond, une bordure optique, un voile de survol, une teinte
// d'icône. Toutes les variantes `colors` ci-dessous ne font que remplir ces
// quatre emplacements avec des jetons.
const solidNeutral =
  'text-(--aig-text) [--btn-bg:var(--aig-raised)] [--btn-border:var(--aig-line)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

// Ces chaînes sont écrites EN TOUTES LETTRES à dessein : le scanner Tailwind
// extrait les classes statiquement, une classe construite par interpolation
// n'émet aucun CSS. Vérifié sur le build — la version factorisée était muette.
const solidBad =
  'text-(--aig-text) [--btn-bg:color-mix(in_oklab,var(--aig-severity-bad)_70%,var(--aig-raised))] [--btn-border:var(--aig-severity-bad)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

const solidWarn =
  'text-(--aig-text) [--btn-bg:color-mix(in_oklab,var(--aig-severity-warn)_70%,var(--aig-raised))] [--btn-border:var(--aig-severity-warn)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

const solidGood =
  'text-(--aig-text) [--btn-bg:color-mix(in_oklab,var(--aig-severity-good)_70%,var(--aig-raised))] [--btn-border:var(--aig-severity-good)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

const solidRunning =
  'text-(--aig-text) [--btn-bg:color-mix(in_oklab,var(--aig-severity-running)_70%,var(--aig-raised))] [--btn-border:var(--aig-severity-running)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

const solidBlocked =
  'text-(--aig-text) [--btn-bg:color-mix(in_oklab,var(--aig-severity-blocked)_70%,var(--aig-raised))] [--btn-border:var(--aig-severity-blocked)] [--btn-hover-overlay:var(--aig-line-soft)] [--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]'

const styles = {
  base: [
    // Base
    'relative isolate inline-flex items-baseline justify-center gap-x-2 rounded-lg border text-base/6 font-semibold',
    // Sizing
    'px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)] sm:text-sm/6',
    // Focus
    'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-(--aig-accent)',
    // Disabled
    'data-disabled:opacity-50',
    // Icon
    '*:data-[slot=icon]:-mx-0.5 *:data-[slot=icon]:my-0.5 *:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 *:data-[slot=icon]:self-center *:data-[slot=icon]:text-(--btn-icon) sm:*:data-[slot=icon]:my-1 sm:*:data-[slot=icon]:size-4 forced-colors:[--btn-icon:ButtonText] forced-colors:data-hover:[--btn-icon:ButtonText]',
  ],
  solid: [
    // Dark-first: the background sits on the control itself and the border is
    // the optical outline — the light-mode `before` layer is never rendered.
    'bg-(--btn-bg) border-(--btn-border)',
    // Background layer kept in the DOM for the stacking contract, hidden as in dark mode
    'before:absolute before:inset-0 before:-z-10 before:rounded-[calc(var(--radius-lg)-1px)] before:bg-(--btn-bg)',
    'before:hidden',
    // Shim/overlay, inset to match button foreground and used for hover state + highlight shadow
    'after:absolute after:inset-0 after:-z-10 after:rounded-[calc(var(--radius-lg)-1px)]',
    // Inner highlight shadow
    'after:shadow-[inset_0_1px_oklch(1_0_0/0.10)]',
    // Overlay on hover
    'data-active:after:bg-(--btn-hover-overlay) data-hover:after:bg-(--btn-hover-overlay)',
    // `after` layer expands to cover entire button
    'after:-inset-px after:rounded-lg',
    // Disabled
    'data-disabled:before:shadow-none data-disabled:after:shadow-none',
  ],
  outline: [
    // Base
    'border-(--aig-line) text-(--aig-text) [--btn-bg:transparent] data-active:bg-(--aig-line-soft) data-hover:bg-(--aig-line-soft)',
    // Icon
    '[--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]',
  ],
  plain: [
    // Base
    'border-transparent text-(--aig-text) data-active:bg-(--aig-line-soft) data-hover:bg-(--aig-line-soft)',
    // Icon
    '[--btn-icon:var(--aig-text-muted)] data-active:[--btn-icon:var(--aig-text)] data-hover:[--btn-icon:var(--aig-text)]',
  ],
  colors: {
    'dark/zinc': [solidNeutral],
    light: [solidNeutral],
    'dark/white': [solidNeutral],
    dark: [solidNeutral],
    white: [solidNeutral],
    zinc: [solidNeutral],
    indigo: [solidRunning],
    cyan: [solidRunning],
    red: [solidBad],
    orange: [solidWarn],
    amber: [solidWarn],
    yellow: [solidWarn],
    lime: [solidGood],
    green: [solidGood],
    emerald: [solidGood],
    teal: [solidGood],
    sky: [solidRunning],
    blue: [solidRunning],
    violet: [solidBlocked],
    purple: [solidBlocked],
    fuchsia: [solidBlocked],
    pink: [solidBad],
    rose: [solidBad],
  },
}

type ButtonProps = Readonly<
  (
    | { color?: keyof typeof styles.colors; outline?: never; plain?: never }
    | { color?: never; outline: true; plain?: never }
    | { color?: never; outline?: never; plain: true }
  ) & { className?: string; children: React.ReactNode } & (
      | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
      | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
    )
>

function buttonVariantClasses(
  outline: boolean | undefined,
  plain: boolean | undefined,
  color: ButtonProps['color'],
): string {
  if (outline) return clsx(styles.outline)
  if (plain) return clsx(styles.plain)
  return clsx(styles.solid, styles.colors[color ?? 'dark/zinc'])
}

export const Button = forwardRef(function Button(
  { color, outline, plain, className, children, ...props }: ButtonProps,
  ref: React.ForwardedRef<HTMLElement>
) {
  const classes = clsx(className, styles.base, buttonVariantClasses(outline, plain, color))

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>{children}</TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={clsx(classes, 'cursor-default')} ref={ref}>
      <TouchTarget>{children}</TouchTarget>
    </Headless.Button>
  )
})

/**
 * Expand the hit area to at least 44×44px on touch devices
 */
export function TouchTarget({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      <span
        className="absolute top-1/2 left-1/2 size-[max(100%,2.75rem)] -translate-x-1/2 -translate-y-1/2 pointer-fine:hidden"
        aria-hidden="true"
      />
      {children}
    </>
  )
}
