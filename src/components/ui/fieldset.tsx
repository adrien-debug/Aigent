// Couleurs issues des jetons `--aig-*` (voir `src/app/globals.css`). Les
// variantes `dark:` ont disparu : les jetons sont déjà sombres, une paire
// `X dark:Y` se réduit donc à une seule valeur.
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function Fieldset({
  className,
  ...props
}: Readonly<{ className?: string } & Omit<Headless.FieldsetProps, 'as' | 'className'>>) {
  return (
    <Headless.Fieldset
      {...props}
      className={clsx(className, '*:data-[slot=text]:mt-1 [&>*+[data-slot=control]]:mt-6')}
    />
  )
}

export function Legend({
  className,
  ...props
}: Readonly<{ className?: string } & Omit<Headless.LegendProps, 'as' | 'className'>>) {
  return (
    <Headless.Legend
      data-slot="legend"
      {...props}
      className={clsx(
        className,
        'text-base/6 font-semibold text-(--aig-text) data-disabled:opacity-50 sm:text-sm/6'
      )}
    />
  )
}

export function FieldGroup({ className, ...props }: Readonly<React.ComponentPropsWithoutRef<'div'>>) {
  return <div data-slot="control" {...props} className={clsx(className, 'space-y-8')} />
}

export function Field({ className, ...props }: Readonly<{ className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>>) {
  return (
    <Headless.Field
      {...props}
      className={clsx(
        className,
        '[&>[data-slot=label]+[data-slot=control]]:mt-3',
        '[&>[data-slot=label]+[data-slot=description]]:mt-1',
        '[&>[data-slot=description]+[data-slot=control]]:mt-3',
        '[&>[data-slot=control]+[data-slot=description]]:mt-3',
        '[&>[data-slot=control]+[data-slot=error]]:mt-3',
        '*:data-[slot=label]:font-medium'
      )}
    />
  )
}

export function Label({ className, ...props }: Readonly<{ className?: string } & Omit<Headless.LabelProps, 'as' | 'className'>>) {
  return (
    <Headless.Label
      data-slot="label"
      {...props}
      className={clsx(
        className,
        'text-base/6 text-(--aig-text) select-none data-disabled:opacity-50 sm:text-sm/6'
      )}
    />
  )
}

export function Description({
  className,
  ...props
}: Readonly<{ className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>>) {
  return (
    <Headless.Description
      data-slot="description"
      {...props}
      className={clsx(className, 'text-base/6 text-(--aig-text-muted) data-disabled:opacity-50 sm:text-sm/6')}
    />
  )
}

export function ErrorMessage({
  className,
  ...props
}: Readonly<{ className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>>) {
  return (
    <Headless.Description
      data-slot="error"
      {...props}
      className={clsx(className, 'text-base/6 text-(--aig-severity-bad) data-disabled:opacity-50 sm:text-sm/6')}
    />
  )
}
