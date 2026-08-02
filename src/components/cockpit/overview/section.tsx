import type { ReactNode } from 'react'

/**
 * Section plate de l'Aperçu — titre + contenu, sans hairline intermédiaire.
 * La séparation vient de l'espacement entre sections, pas d'une boîte de plus.
 */
export function OverviewSection({
  title,
  hint,
  actions,
  children,
  className,
}: Readonly<{
  title: string
  hint?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}>) {
  return (
    <section className={`flex min-h-0 flex-col ${className ?? ''}`}>
      <div className="mb-4 flex min-w-0 items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="aig-text truncate text-sm font-semibold tracking-[-0.01em]">{title}</h3>
          {hint ? <p className="aig-text-faint mt-1 truncate text-xs uppercase tracking-wider">{hint}</p> : null}
        </div>
        {actions ? <div className="shrink-0 pt-0.5">{actions}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  )
}
