import * as Headless from '@headlessui/react'

/**
 * Softened accent CTA — veiled pastel accent (same tone as the active nav
 * item), never the solid accent-700 button. THE one accent action style
 * across /admin pages (New copilot, New project, Assign, Unassign, ...) so
 * they never drift to a neutral zinc button.
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
