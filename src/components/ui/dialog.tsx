'use client'

import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import type React from 'react'
import { Text } from './text'

const sizes = {
  xs: 'sm:max-w-xs',
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
  xl: 'sm:max-w-xl',
  '2xl': 'sm:max-w-2xl',
  '3xl': 'sm:max-w-3xl',
  '4xl': 'sm:max-w-4xl',
  '5xl': 'sm:max-w-5xl',
}

export function Dialog({
  size = 'lg',
  className,
  children,
  ...props
}: { size?: keyof typeof sizes; className?: string; children: React.ReactNode } & Omit<Headless.DialogProps, 'as' | 'className'>) {
  return (
    <Headless.Dialog {...props} className="relative z-50">
      <div className="fixed inset-0 flex w-screen items-center justify-center overflow-y-auto bg-zinc-950/25 p-4 dark:bg-zinc-950/50">
        <Headless.DialogPanel
          className={clsx(
            className,
            sizes[size],
            'w-full min-w-0 rounded-2xl bg-white p-8 shadow-lg ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10'
          )}
        >
          {children}
        </Headless.DialogPanel>
      </div>
    </Headless.Dialog>
  )
}

export function DialogTitle({ className, ...props }: { className?: string } & Omit<Headless.DialogTitleProps, 'as' | 'className'>) {
  return <Headless.DialogTitle {...props} className={clsx(className, 'text-base font-semibold text-zinc-950 dark:text-white')} />
}

export function DialogDescription({
  className,
  ...props
}: { className?: string } & Omit<Headless.DescriptionProps<typeof Text>, 'as' | 'className'>) {
  return <Headless.Description as={Text} {...props} className={clsx(className, 'mt-2')} />
}

export function DialogBody({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'mt-6')} />
}

export function DialogActions({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) {
  return <div {...props} className={clsx(className, 'mt-8 flex flex-col-reverse items-center justify-end gap-3 sm:flex-row')} />
}
