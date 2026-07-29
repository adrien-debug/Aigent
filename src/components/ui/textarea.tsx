import * as Headless from '@headlessui/react'
import React, { forwardRef } from 'react'
import { cn } from './cn'

export const Textarea = forwardRef(function Textarea(
  { className, ...props }: { className?: string } & Omit<Headless.TextareaProps, 'as' | 'className'>,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {
  return (
    <Headless.Textarea
      ref={ref}
      {...props}
      className={cn(
        'block w-full resize-y rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-base/6 text-white',
        'placeholder:text-zinc-500 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30',
        'disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm/6',
        className
      )}
    />
  )
})
