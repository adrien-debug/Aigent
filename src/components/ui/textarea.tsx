import clsx from 'clsx'
import React, { forwardRef } from 'react'

export const Textarea = forwardRef(function Textarea(
  { className, resizable = true, ...props }: { className?: string; resizable?: boolean } & React.ComponentPropsWithoutRef<'textarea'>,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {
  return (
    <textarea
      ref={ref}
      {...props}
      className={clsx(
        className,
        'block w-full rounded-lg border border-zinc-950/10 bg-transparent px-3 py-2 text-sm text-zinc-950 placeholder:text-zinc-500',
        'focus:outline-none focus:ring-2 focus:ring-blue-500',
        'disabled:opacity-50',
        'dark:border-white/10 dark:bg-white/5 dark:text-white',
        resizable ? 'resize-y' : 'resize-none'
      )}
    />
  )
})
