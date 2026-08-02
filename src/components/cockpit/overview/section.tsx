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
    <section className={className}>
      <div className="mb-3 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="aig-h3 truncate">{title}</h3>
        {hint ? <p className="aig-text-faint truncate text-3xs">{hint}</p> : null}
        {actions ? <div className="ml-auto shrink-0">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
