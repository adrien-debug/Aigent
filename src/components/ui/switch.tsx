import * as Headless from '@headlessui/react'
import { cn } from './cn'

const colors = {
  'dark/zinc': [
    '[--switch-bg-ring:var(--color-zinc-950)]/90 [--switch-bg:var(--color-zinc-900)] dark:[--switch-bg-ring:transparent] dark:[--switch-bg:var(--color-white)]/25',
    '[--switch-ring:var(--color-zinc-950)]/90 [--switch-shadow:var(--color-black)]/10 [--switch:white] dark:[--switch-ring:var(--color-zinc-700)]/90',
  ],
  'dark/white': [
    '[--switch-bg-ring:var(--color-zinc-950)]/90 [--switch-bg:var(--color-zinc-900)] dark:[--switch-bg-ring:transparent] dark:[--switch-bg:var(--color-white)]',
    '[--switch-ring:var(--color-zinc-950)]/90 [--switch-shadow:var(--color-black)]/10 [--switch:white] dark:[--switch-ring:transparent] dark:[--switch:var(--color-zinc-900)]',
  ],
  dark: [
    '[--switch-bg-ring:var(--color-zinc-950)]/90 [--switch-bg:var(--color-zinc-900)] dark:[--switch-bg-ring:var(--color-white)]/15',
    '[--switch-ring:var(--color-zinc-950)]/90 [--switch-shadow:var(--color-black)]/10 [--switch:white]',
  ],
  zinc: [
    '[--switch-bg-ring:var(--color-zinc-700)]/90 [--switch-bg:var(--color-zinc-600)] dark:[--switch-bg-ring:transparent]',
    '[--switch-shadow:var(--color-black)]/10 [--switch:white] [--switch-ring:var(--color-zinc-700)]/90',
  ],
  white: [
    '[--switch-bg-ring:var(--color-black)]/15 [--switch-bg:white] dark:[--switch-bg-ring:transparent]',
    '[--switch-shadow:var(--color-black)]/10 [--switch-ring:transparent] [--switch:var(--color-zinc-950)]',
  ],
  // The single brand accent switch track (design-system monochrome).
  accent: [
    '[--switch-bg-ring:var(--color-accent-700)]/90 [--switch-bg:var(--color-accent-600)] dark:[--switch-bg-ring:transparent]',
    '[--switch:white] [--switch-ring:var(--color-accent-700)]/90 [--switch-shadow:var(--color-accent-900)]/20',
  ],
}

type Color = keyof typeof colors

export function Switch({
  color = 'dark/zinc',
  locked = false,
  disabled,
  className,
  title,
  ...props
}: {
  color?: Color
  /**
   * Expresses a "locked-on" state: the switch is ON, non-interactive, but must
   * NOT read as a regular disabled/dimmed control. Used for permissions that are
   * always required (e.g. confirmation on high/critical risk tools) — the switch
   * stays visually "on" and gains a distinct locked affordance instead of fading.
   * Implies `disabled`; pass `checked` separately as usual.
   */
  locked?: boolean
  className?: string
} & Omit<Headless.SwitchProps, 'as' | 'className' | 'children'>) {
  const isDisabled = locked || disabled

  return (
    <Headless.Switch
      data-slot="control"
      data-locked={locked ? 'true' : undefined}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-readonly={locked || undefined}
      title={title}
      {...props}
      className={cn(
        // Base styles
        'group relative isolate inline-flex h-6 w-10 cursor-default rounded-full p-[3px] sm:h-5 sm:w-8',
        // Transitions
        'transition duration-0 ease-in-out data-changing:duration-200',
        // Outline and background color in forced-colors mode so switch is still visible
        'forced-colors:outline forced-colors:[--switch-bg:Highlight] dark:forced-colors:[--switch-bg:Highlight]',
        // Unchecked
        'bg-zinc-200 ring-1 ring-black/5 ring-inset dark:bg-white/5 dark:ring-white/15',
        // Checked
        'data-checked:bg-(--switch-bg) data-checked:ring-(--switch-bg-ring) dark:data-checked:bg-(--switch-bg) dark:data-checked:ring-(--switch-bg-ring)',
        // Focus
        'focus:not-data-focus:outline-hidden data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500',
        // Hover
        'data-hover:ring-black/15 data-hover:data-checked:ring-(--switch-bg-ring)',
        'dark:data-hover:ring-white/25 dark:data-hover:data-checked:ring-(--switch-bg-ring)',
        // Disabled (regular): fade out — reads as "off limits"
        !locked &&
          'data-disabled:bg-zinc-200 data-disabled:opacity-50 data-disabled:data-checked:bg-zinc-200 data-disabled:data-checked:ring-black/5',
        !locked &&
          'dark:data-disabled:bg-white/15 dark:data-disabled:data-checked:bg-white/15 dark:data-disabled:data-checked:ring-white/15',
        // Locked-on: keep full color (no fade), swap the cursor, add a locked ring
        // so it reads as "on and locked" rather than "off and unavailable".
        locked &&
          'cursor-not-allowed data-disabled:data-checked:bg-(--switch-bg) data-disabled:data-checked:ring-2 data-disabled:data-checked:ring-offset-1 data-disabled:data-checked:ring-(--switch-bg-ring) dark:data-disabled:data-checked:bg-(--switch-bg) dark:data-disabled:data-checked:ring-(--switch-bg-ring)',
        // Color specific styles
        colors[color],
        className
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Basic layout
          'pointer-events-none relative inline-block size-4.5 rounded-full sm:size-3.5',
          // Transition
          'translate-x-0 transition duration-200 ease-in-out',
          // Invisible border so the switch is still visible in forced-colors mode
          'border border-transparent',
          // Unchecked
          'bg-white shadow-sm ring-1 ring-black/5',
          // Checked
          'group-data-checked:bg-(--switch) group-data-checked:shadow-(--switch-shadow) group-data-checked:ring-(--switch-ring)',
          'group-data-checked:translate-x-4 sm:group-data-checked:translate-x-3',
          // Disabled (regular): flatten the knob to plain white — "off limits"
          !locked &&
            'group-data-checked:group-data-disabled:bg-white group-data-checked:group-data-disabled:shadow-sm group-data-checked:group-data-disabled:ring-black/5',
          // Locked-on: keep the knob in its normal "on" color, add a small lock
          // glyph baked as a background so the affordance survives at any size.
          locked &&
            "group-data-checked:group-data-disabled:bg-(--switch) group-data-checked:group-data-disabled:shadow-(--switch-shadow) group-data-checked:group-data-disabled:ring-(--switch-ring) group-data-checked:group-data-disabled:after:absolute group-data-checked:group-data-disabled:after:inset-0 group-data-checked:group-data-disabled:after:m-auto group-data-checked:group-data-disabled:after:size-2 group-data-checked:group-data-disabled:after:rounded-[1px] group-data-checked:group-data-disabled:after:bg-(--switch-bg) group-data-checked:group-data-disabled:after:content-['']"
        )}
      />
    </Headless.Switch>
  )
}
