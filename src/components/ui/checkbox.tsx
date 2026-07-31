import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'

export function CheckboxGroup({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'space-y-3')} />
}

export function CheckboxField({ className, ...props }: { className?: string } & Omit<Headless.FieldProps, 'as' | 'className'>) {
  return <Headless.Field {...props} className={clsx(className, 'flex items-start gap-3')} />
}

export function Checkbox({ className, ...props }: { className?: string } & Omit<Headless.CheckboxProps, 'as' | 'className'>) {
  return (
    <Headless.Checkbox
      {...props}
      className={clsx(
        className,
        'group mt-0.5 flex size-4 items-center justify-center rounded border border-zinc-950/15 bg-white',
        'data-checked:border-transparent data-checked:bg-zinc-900',
        'focus:outline-none data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-blue-500',
        'dark:border-white/15 dark:bg-white/5 dark:data-checked:bg-zinc-100'
      )}
    >
      <svg className="size-3 stroke-white opacity-0 group-data-checked:opacity-100 dark:stroke-zinc-900" viewBox="0 0 14 14" fill="none">
        <path d="M3 8L6 11L11 3.5" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Headless.Checkbox>
  )
}
