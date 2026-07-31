import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function Fieldset({ className, ...props }: { className?: string } & Omit<Headless.FieldsetProps, 'as' | 'className'>) {
  return <Headless.Fieldset {...props} className={clsx(className, 'space-y-6')} />
}

export function Legend({ className, ...props }: { className?: string } & Omit<Headless.LegendProps, 'as' | 'className'>) {
  return <Headless.Legend {...props} className={clsx(className, 'text-sm font-semibold text-zinc-950 dark:text-white')} />
}

export function FieldGroup({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'space-y-8')} />
}

export function Field({ className, ...props }: { className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>) {
  return <Headless.Field {...props} className={clsx(className, 'space-y-1')} />
}

export function Label({ className, ...props }: { className?: string } & Omit<Headless.LabelProps, 'as' | 'className'>) {
  return <Headless.Label {...props} className={clsx(className, 'block text-sm font-medium text-zinc-950 dark:text-white')} />
}

export function Description({ className, ...props }: { className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>) {
  return <Headless.Description {...props} className={clsx(className, 'text-sm text-zinc-500 dark:text-zinc-400')} />
}

export function ErrorMessage({ className, ...props }: { className?: string } & Omit<Headless.DescriptionProps, 'as' | 'className'>) {
  return <Headless.Description {...props} className={clsx(className, 'text-sm text-red-600 dark:text-red-500')} />
}
