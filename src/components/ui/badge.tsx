/*
 * Couleurs : jetons `--aig-*` uniquement (voir `src/app/globals.css`).
 * Les variantes `dark:` du kit Catalyst ont disparu — les jetons sont déjà
 * sombres, donc chaque paire `clair dark:sombre` se réduit à une seule valeur.
 * Les clés de `colors` sont conservées à l'identique : le produit en consomme
 * plusieurs et le typage en dépend. Seules les couleurs changent ici.
 */
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import { TouchTarget } from './button'
import { Link } from './link'

const severity = {
  bad: 'bg-[color-mix(in_oklab,var(--aig-severity-bad)_15%,transparent)] text-(--aig-severity-bad) group-data-hover:bg-[color-mix(in_oklab,var(--aig-severity-bad)_25%,transparent)]',
  warn: 'bg-[color-mix(in_oklab,var(--aig-severity-warn)_15%,transparent)] text-(--aig-severity-warn) group-data-hover:bg-[color-mix(in_oklab,var(--aig-severity-warn)_25%,transparent)]',
  good: 'bg-[color-mix(in_oklab,var(--aig-severity-good)_15%,transparent)] text-(--aig-severity-good) group-data-hover:bg-[color-mix(in_oklab,var(--aig-severity-good)_25%,transparent)]',
  running:
    'bg-[color-mix(in_oklab,var(--aig-severity-running)_15%,transparent)] text-(--aig-severity-running) group-data-hover:bg-[color-mix(in_oklab,var(--aig-severity-running)_25%,transparent)]',
  blocked:
    'bg-[color-mix(in_oklab,var(--aig-severity-blocked)_15%,transparent)] text-(--aig-severity-blocked) group-data-hover:bg-[color-mix(in_oklab,var(--aig-severity-blocked)_25%,transparent)]',
  neutral: 'bg-(--aig-line-soft) text-(--aig-text-muted) group-data-hover:bg-(--aig-line)',
} as const

const colors = {
  red: severity.bad,
  orange: severity.warn,
  amber: severity.warn,
  yellow: severity.warn,
  lime: severity.good,
  green: severity.good,
  emerald: severity.good,
  teal: severity.good,
  cyan: severity.running,
  sky: severity.running,
  blue: severity.running,
  indigo: severity.running,
  violet: severity.blocked,
  purple: severity.blocked,
  fuchsia: severity.blocked,
  pink: severity.bad,
  rose: severity.bad,
  zinc: severity.neutral,
}

type BadgeProps = Readonly<{ color?: keyof typeof colors }>

export function Badge({
  color = 'zinc',
  className,
  ...props
}: Readonly<BadgeProps & React.ComponentPropsWithoutRef<'span'>>) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        'inline-flex items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-sm/5 font-medium sm:text-xs/5 forced-colors:outline',
        colors[color]
      )}
    />
  )
}

export const BadgeButton = forwardRef(function BadgeButton(
  {
    color = 'zinc',
    className,
    children,
    ...props
  }: Readonly<
    BadgeProps & { className?: string; children: React.ReactNode } & (
      | ({ href?: never } & Omit<Headless.ButtonProps, 'as' | 'className'>)
      | ({ href: string } & Omit<React.ComponentPropsWithoutRef<typeof Link>, 'className'>)
    )
  >,
  ref: React.ForwardedRef<HTMLElement>
) {
  const classes = clsx(
    className,
    'group relative inline-flex rounded-md focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-(--aig-accent)'
  )

  return typeof props.href === 'string' ? (
    <Link {...props} className={classes} ref={ref as React.ForwardedRef<HTMLAnchorElement>}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Link>
  ) : (
    <Headless.Button {...props} className={classes} ref={ref}>
      <TouchTarget>
        <Badge color={color}>{children}</Badge>
      </TouchTarget>
    </Headless.Button>
  )
})
