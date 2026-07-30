import * as Headless from '@headlessui/react'
import React, { forwardRef } from 'react'
import { cn } from './cn'

/**
 * Catalyst `Select`, adapted to this project the same way `input.tsx` was.
 *
 * Deviations from the shipped kit, all deliberate:
 *  - `clsx` → `cn` (project helper).
 *  - `ring-blue-500` → `ring-accent-500`: this console has ONE accent, and it is
 *    not blue (`AGENTS.md`, `src/theme.css`).
 *  - The focus ring is UNCONDITIONAL, not `sm:`-gated. The kit pairs a
 *    `sm:`-only ring with `focus:outline-hidden` on the control, so under 640px
 *    a focused select had no focus indicator at all — the same WCAG 2.4.7
 *    failure already documented and fixed in `input.tsx`. Fixing it here too
 *    keeps the two controls consistent, since they sit side by side in the runs
 *    and agents filter bars.
 *  - Light-mode `before:bg-white` is dropped: this console is dark-only, and the
 *    pseudo-element only ever painted white behind a dark control.
 */
export const Select = forwardRef(function Select(
  { className, multiple, ...props }: { className?: string } & Omit<Headless.SelectProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLSelectElement>
) {
  return (
    <span
      data-slot="control"
      className={cn([
        // Basic layout. `w-full` first so a caller in a flex filter bar can pass
        // `w-auto` and win — `cn` (tailwind-merge) keeps the LAST width class,
        // and these selects sit inline beside an Input, not stacked.
        'group relative block w-full',
        className,
        // Focus ring — unconditional, see the note above.
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-transparent after:ring-inset has-data-focus:after:ring-2 has-data-focus:after:ring-accent-500',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:shadow-none',
      ])}
    >
      <Headless.Select
        ref={ref}
        multiple={multiple}
        {...props}
        className={cn([
          // Basic layout — compact by default: these live in dense filter bars.
          'relative block w-full appearance-none rounded-lg py-1.5',
          // Horizontal padding
          multiple ? 'px-2.5' : 'pr-8 pl-2.5',
          // Options (multi-select)
          '[&_optgroup]:font-semibold',
          // Typography — `*:` also styles the popup options, which the browser
          // renders outside this element's own cascade.
          'text-xs text-content *:bg-surface-raised *:text-content',
          // Border
          'border border-line data-hover:border-line-strong',
          // Background color
          'bg-surface-sunken',
          // Hide default focus styles (the ring above replaces them)
          'focus:outline-hidden',
          // Invalid state
          'data-invalid:border-red-600 data-invalid:data-hover:border-red-600',
          // Disabled state
          'data-disabled:border-white/15 data-disabled:opacity-100 data-hover:data-disabled:border-white/15',
        ])}
      />
      {!multiple && (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg
            className="size-4 stroke-zinc-400 group-has-data-disabled:stroke-zinc-600 forced-colors:stroke-[CanvasText]"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path d="M5.75 10.75L8 13L10.25 10.75" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            <path d="M10.25 5.25L8 3L5.75 5.25" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </span>
  )
})
