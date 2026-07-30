import * as Headless from '@headlessui/react'
import { cn } from './cn'

/**
 * Catalyst `Checkbox`, adapted to this project.
 *
 * Deviations from the shipped kit, all deliberate:
 *  - `clsx` → `cn` (project helper).
 *  - The kit's 22-entry `colors` map is reduced to ONE accent. This console has
 *    a single accent (`AGENTS.md`), and `npm run quality:dead` fails on an
 *    export nothing consumes — shipping 21 unused colour variants would be the
 *    "components for later" the same rule forbids. The `color` prop is dropped
 *    with them: an API nobody can vary is noise.
 *  - `outline-blue-500` → `outline-accent-500`, same single-accent rule.
 *  - Light-mode `before:`/`after:` layers are dropped: the console is dark-only,
 *    so those pseudo-elements only ever painted a white card that is never seen.
 *  - `CheckboxGroup` / `CheckboxField` are NOT ported: nothing consumes them
 *    today, and `quality:dead` would fail on them.
 */
export function Checkbox({
  className,
  ...props
}: {
  className?: string
} & Omit<Headless.CheckboxProps, 'as' | 'className'>) {
  return (
    <Headless.Checkbox
      data-slot="control"
      {...props}
      className={cn(className, 'group inline-flex focus:outline-hidden')}
    >
      <span
        className={cn([
          // Basic layout
          'relative isolate flex size-3.5 items-center justify-center rounded-[0.3125rem]',
          // The check mark and the box it sits in, in this console's one accent.
          '[--checkbox-check:var(--color-zinc-950)] [--checkbox-checked-bg:var(--color-accent-500)]',
          // Background color
          'bg-white/5 group-data-checked:bg-(--checkbox-checked-bg)',
          // Border
          'border border-white/15 group-data-checked:border-transparent group-data-hover:border-white/30 group-data-hover:group-data-checked:border-transparent',
          // Focus ring
          'group-data-focus:outline-2 group-data-focus:outline-offset-2 group-data-focus:outline-accent-500',
          // Disabled state
          'group-data-disabled:opacity-50 group-data-disabled:border-white/20 group-data-disabled:bg-white/2.5',
          // Forced colors mode
          'forced-colors:[--checkbox-check:HighlightText] forced-colors:[--checkbox-checked-bg:Highlight] forced-colors:group-data-disabled:[--checkbox-check:Highlight]',
        ])}
      >
        <svg
          className="size-3.5 stroke-(--checkbox-check) opacity-0 group-data-checked:opacity-100"
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
