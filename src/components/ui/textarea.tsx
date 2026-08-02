// Couleurs issues des jetons `--aig-*` (voir `src/app/globals.css`). Les
// variantes `dark:` ont disparu : les jetons sont déjà sombres, une paire
// `X dark:Y` se réduit donc à une seule valeur.
import * as Headless from '@headlessui/react'
import clsx from 'clsx'
import React, { forwardRef } from 'react'

export const Textarea = forwardRef(function Textarea(
  {
    className,
    resizable = true,
    ...props
  }: Readonly<{ className?: string; resizable?: boolean } & Omit<Headless.TextareaProps, 'as' | 'className'>>,
  ref: React.ForwardedRef<HTMLTextAreaElement>
) {
  return (
    <span
      data-slot="control"
      className={clsx([
        className,
        // Basic layout
        'relative block w-full',
        // Le pseudo `before` ne servait qu'au mode clair (il etait deja masque en
        // sombre). Le produit etant dark-first, il reste masque en permanence : la
        // couleur de fond est portee par le controle lui-meme.
        'before:absolute before:inset-px before:rounded-[calc(var(--radius-md)-1px)] before:hidden',
        // Focus ring
        'after:pointer-events-none after:absolute after:inset-0 after:rounded-md after:ring-transparent after:ring-inset sm:focus-within:after:ring-2 sm:focus-within:after:ring-(--aig-accent)',
        // Disabled state
        'has-data-disabled:opacity-50 has-data-disabled:before:shadow-none',
      ])}
    >
      <Headless.Textarea
        ref={ref}
        {...props}
        className={clsx([
          // Basic layout
          'relative block h-full w-full appearance-none rounded-md px-[calc(--spacing(3.5)-1px)] py-[calc(--spacing(2.5)-1px)] sm:px-[calc(--spacing(3)-1px)] sm:py-[calc(--spacing(1.5)-1px)]',
          // Typography
          'text-base/6 text-(--aig-text) placeholder:text-(--aig-text-muted) sm:text-sm/6',
          // Border
          'border border-(--border-default) data-hover:border-(--border-default)',
          // Background color
          'bg-(--aig-line-soft)',
          // Hide default focus styles
          'focus:outline-hidden',
          // Invalid state
          'data-invalid:border-(--aig-severity-bad) data-invalid:data-hover:border-(--aig-severity-bad)',
          // Disabled state
          'disabled:border-(--aig-line) disabled:bg-(--aig-subtle) data-hover:disabled:border-(--aig-line)',
          // Resizable
          resizable ? 'resize-y' : 'resize-none',
        ])}
      />
    </span>
  )
})
