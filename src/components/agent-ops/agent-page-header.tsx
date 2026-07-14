import clsx from 'clsx'
import Link from 'next/link'

export interface Breadcrumb {
  label: string
  href?: string
}

export interface AgentPageHeaderProps {
  title: string
  description?: string
  breadcrumbs?: Breadcrumb[]
  environment?: string
  live?: boolean
  actions?: React.ReactNode
  filters?: React.ReactNode
  className?: string
}

export function AgentPageHeader({
  title,
  description,
  breadcrumbs,
  environment,
  live,
  actions,
  filters,
  className,
}: AgentPageHeaderProps) {
  return (
    <div className={clsx('flex flex-col gap-3 mb-10', className)}>
      {/* Top row: Breadcrumbs & Environment (ultra minimal) */}
      <div className="flex items-center justify-between">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="flex" aria-label="Breadcrumb">
            <ol role="list" className="flex items-center space-x-1.5">
              {breadcrumbs.map((crumb, idx) => (
                <li key={crumb.label}>
                  <div className="flex items-center">
                    {idx > 0 && (
                      <span className="text-zinc-700 mr-1.5">/</span>
                    )}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="text-[13px] text-zinc-500 hover:text-white transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-[13px] text-zinc-300" aria-current="page">
                        {crumb.label}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </nav>
        ) : <div />}

        {environment && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-zinc-600 font-medium">{environment}</span>
          </div>
        )}
      </div>

      {/* Main row: Title, Description, Live Indicator, Actions */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-medium tracking-tight text-white">
              {title}
            </h1>
            {live && (
              <div className="flex items-center gap-1.5">
                <span className="relative flex size-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75"></span>
                  <span className="relative inline-flex size-1.5 rounded-full bg-accent-500"></span>
                </span>
                <span className="text-[10px] font-medium uppercase tracking-widest text-accent-400">Live</span>
              </div>
            )}
          </div>
          {description && (
            <p className="mt-1.5 text-[13px] text-zinc-500 max-w-2xl">
              {description}
            </p>
          )}
        </div>
        
        {actions && (
          <div className="flex shrink-0 items-center gap-3">
            {actions}
          </div>
        )}
      </div>

      {/* Bottom row: Filters / Contextual tools */}
      {filters && (
        <div className="mt-4 flex items-center gap-4">
          {filters}
        </div>
      )}
    </div>
  )
}
