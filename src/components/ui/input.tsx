import * as Headless from '@headlessui/react'
import React, { forwardRef } from 'react'
import { cn } from './cn'

const dateTypes = ['date', 'datetime-local', 'month', 'time', 'week']
type DateType = (typeof dateTypes)[number]

export const Input = forwardRef(function Input(
  {
    className,
    ...props
  }: {
    className?: string
    type?: 'email' | 'number' | 'password' | 'search' | 'tel' | 'text' | 'url' | DateType
  } & Omit<Headless.InputProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLInputElement>
) {
  return (
    <span
      data-slot="control"
      className={cn([
        // Basic layout
        'relative block w-full',
        // Background color + shadow applied to inset pseudo element, so shadow blends with border in light mode
        'before:absolute before:inset-px before:rounded-[calc(var(--radius-lg)-1px)] before:bg-white before:shadow-sm',
        // Background color is moved to control and shadow is removed in dark mode so hide `before` pseudo
        'dark:before:hidden',
        // Focus ring — UNCONDITIONAL, deliberately not `sm:focus-within:`.
        //
        // The kit ships this rule behind `sm:` while the control itself carries
        // `focus:outline-hidden` (below), which kills the browser's own ring. The
        // two together mean that under 640px a focused field had NO focus
        // indicator at all — measured in Chromium at 390px on /admin/agents/new,
        // real keyboard focus: control `outline-style: none`, wrapper `::after`
        // `box-shadow: none`. Nothing was painted. That is a WCAG 2.4.7 (level A)
        // failure, on the one viewport class where it is hardest to recover from.
        // `Select` never had the `sm:` and proved the fix: it painted the 2px
        // accent ring at 390 as well as at 1280.
        // Re-measured after the change: accent ring rgb(167,251,144) 2px inset at
        // 390 / 768 / 1280 alike, desktop value byte-identical to before.
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-lg after:ring-transparent after:ring-inset focus-within:after:ring-2 focus-within:after:ring-accent-500',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:bg-zinc-950/5 has-data-disabled:before:shadow-none',
        // Caller LAST — the `className` of an <Input> lands on this OUTER wrapper
        // (layout/width), never on the control itself. Unchanged behaviour, only
        // the arbitration order.
        className,
      ])}
    >
      <Headless.Input
        ref={ref}
        {...props}
        className={cn([
          // Date classes
          props.type &&
            dateTypes.includes(props.type) && [
              '[&::-webkit-datetime-edit-fields-wrapper]:p-0',
              '[&::-webkit-date-and-time-value]:min-h-[1.5em]',
              '[&::-webkit-datetime-edit]:inline-flex',
              '[&::-webkit-datetime-edit]:p-0',
              '[&::-webkit-datetime-edit-year-field]:p-0',
              '[&::-webkit-datetime-edit-month-field]:p-0',
              '[&::-webkit-datetime-edit-day-field]:p-0',
              '[&::-webkit-datetime-edit-hour-field]:p-0',
              '[&::-webkit-datetime-edit-minute-field]:p-0',
              '[&::-webkit-datetime-edit-second-field]:p-0',
              '[&::-webkit-datetime-edit-millisecond-field]:p-0',
              '[&::-webkit-datetime-edit-meridiem-field]:p-0',
            ],
          // Basic layout
          'relative block w-full appearance-none rounded-lg px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]',
          // Typography
          'text-base/6 text-zinc-950 placeholder:text-zinc-500 sm:text-sm/6 dark:text-white',
          // Border
          'border border-zinc-950/10 data-hover:border-zinc-950/20 dark:border-white/10 dark:data-hover:border-white/20',
          // Background color
          'bg-transparent dark:bg-white/5',
          // Hide default focus styles
          'focus:outline-hidden',
          // Invalid state — accent, not red (monochrome doctrine). Kept distinct
          // from the neutral resting border (zinc-950/10) and from the accent
          // focus ring (ring-accent-500) by using a stronger, saturated shade.
          'data-invalid:border-accent-600 data-invalid:data-hover:border-accent-600 dark:data-invalid:border-accent-500 dark:data-invalid:data-hover:border-accent-500',
          // Disabled state
          'data-disabled:border-zinc-950/20 dark:data-disabled:border-white/15 dark:data-disabled:bg-white/2.5 dark:data-hover:data-disabled:border-white/15',
          // System icons
          'dark:scheme-dark',
        ])}
      />
    </span>
  )
})
