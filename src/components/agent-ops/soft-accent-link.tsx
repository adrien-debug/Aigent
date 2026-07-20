import * as Headless from '@headlessui/react'
import NextLink from 'next/link'

/**
 * Softened accent CTA — veiled pastel accent (same tone as the active nav
 * item), never the solid accent-700 button. THE one accent action style
 * across /admin pages (New copilot, New project, Assign, Unassign, ...) so
 * they never drift to a neutral zinc button.
 *
 * Exported so the rare component that cannot mount a `<SoftAccentButton>` /
 * `<SoftAccentLink>` (e.g. a bespoke wrapper) consumes the ONE string rather
 * than recopying it character-for-character.
 */
export const softAccentClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-soft)] px-3 py-1.5 text-sm font-medium text-accent-700 ring-1 ring-[var(--accent-line)] transition-colors hover:bg-[var(--accent-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300'

export function SoftAccentButton({
  onClick,
  children,
  ...props
}: { onClick: () => void } & Omit<Headless.ButtonProps, 'className' | 'onClick'>) {
  return (
    <Headless.Button onClick={onClick} className={softAccentClass} {...props}>
      {children}
    </Headless.Button>
  )
}

/**
 * `href` twin of `SoftAccentButton` — for accent CTAs that navigate (empty-state
 * "New project" links, etc.) instead of firing a handler. Same pill, so a
 * navigating CTA never renders as a bare `text-accent-400` inline link.
 */
export function SoftAccentLink({
  href,
  children,
  ...props
}: { href: string } & Omit<React.ComponentPropsWithoutRef<typeof NextLink>, 'className' | 'href'>) {
  return (
    <NextLink href={href} className={softAccentClass} {...props}>
      {children}
    </NextLink>
  )
}
