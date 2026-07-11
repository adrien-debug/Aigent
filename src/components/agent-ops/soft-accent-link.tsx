import { Link } from '@/components/catalyst/link'

/**
 * Softened accent CTA — veiled pastel accent (same tone as the active nav
 * item), never the solid accent-700 button. THE one accent action style
 * across /admin pages (New copilot, New project, Assign, Unassign, ...) so
 * they never drift to a neutral zinc button.
 */
export const softAccentClass =
  'inline-flex items-center gap-1.5 rounded-lg bg-accent-500/10 px-3 py-1.5 text-sm font-medium text-accent-700 ring-1 ring-accent-500/20 transition-colors hover:bg-accent-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300'

export function SoftAccentLink({
  href,
  children,
}: {
  href: string
  children: React.ReactNode
}) {
  return (
    <Link href={href} className={softAccentClass}>
      {children}
    </Link>
  )
}

export function SoftAccentButton({
  onClick,
  children,
  ...props
}: { onClick: () => void } & Omit<React.ComponentPropsWithoutRef<'button'>, 'className' | 'onClick'>) {
  return (
    <button type="button" onClick={onClick} className={softAccentClass} {...props}>
      {children}
    </button>
  )
}
