import * as Headless from '@headlessui/react'
import { cn, responsiveDefault } from './cn'

export function Fieldset({
  className,
  ...props
}: { className?: string } & Omit<Headless.FieldsetProps, 'as' | 'className'>) {
  return (
    <Headless.Fieldset
      {...props}
      className={cn('*:data-[slot=text]:mt-1 [&>*+[data-slot=control]]:mt-6', className)}
    />
  )
}

export function Field({ className, ...props }: { className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>) {
  return (
    <Headless.Field
      {...props}
      className={cn(
        '[&>[data-slot=label]+[data-slot=control]]:mt-3',
        '[&>[data-slot=label]+[data-slot=description]]:mt-1',
        '[&>[data-slot=description]+[data-slot=control]]:mt-3',
        '[&>[data-slot=control]+[data-slot=description]]:mt-3',
        '[&>[data-slot=control]+[data-slot=error]]:mt-3',
        '*:data-[slot=label]:font-medium',
        className
      )}
    />
  )
}

export function Label({ className, ...props }: { className?: string } & Omit<Headless.LabelProps, 'as' | 'className'>) {
  return (
    <Headless.Label
      data-slot="label"
      {...props}
      className={cn(
        'text-zinc-950 select-none data-disabled:opacity-50 dark:text-white',
        responsiveDefault('text-sm/6', 'max-sm:text-base/6', className),
        className
      )}
    />
  )
}

export function Description({
  className,
  ...props
}: { className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>) {
  return (
    <Headless.Description
      data-slot="description"
      {...props}
      // Same split as Text (see `responsiveDefault` in ./cn): the desktop size is
      // the BARE rung so a caller's `text-xs` merges against it, and the phone
      // bump withdraws when the caller declares a size. `dark:text-zinc-400`
      // stays a variant, so a caller repainting this Description must pass its
      // own `dark:` half — the two callers that do already get it right.
      className={cn(
        'text-zinc-500 data-disabled:opacity-50 dark:text-zinc-400',
        responsiveDefault('text-sm/6', 'max-sm:text-base/6', className),
        className
      )}
    />
  )
}

export function ErrorMessage({
  className,
  ...props
}: { className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>) {
  return (
    <Headless.Description
      data-slot="error"
      {...props}
      className={cn(
        // Monochrome doctrine: errors stay in the accent hue, not red. Kept
        // visually DISTINCT from Description (text-zinc-500) by combining two
        // levers — accent color + semibold weight — rather than color alone.
        // accent-700/accent-400 clear WCAG AA (≥4.5:1) on white/zinc-900
        // respectively; see scripts/check-palette.mjs for the contrast gate.
        'font-semibold text-accent-700 data-disabled:opacity-50 dark:text-accent-400',
        responsiveDefault('text-sm/6', 'max-sm:text-base/6', className),
        className
      )}
    />
  )
}
