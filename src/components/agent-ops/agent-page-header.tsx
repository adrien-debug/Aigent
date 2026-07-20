import clsx from 'clsx'

import { Badge } from '@/components/catalyst/badge'
import { Heading } from '@/components/catalyst/heading'
import { Link } from '@/components/catalyst/link'
import { Text } from '@/components/catalyst/text'

interface Breadcrumb {
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

/**
 * Canvas page header with optional breadcrumbs / live / filters.
 * Typography matches `AdminPageHeader` (Catalyst `Heading` = text-2xl/8).
 * Prefer `AdminPageHeader` when breadcrumbs are not needed.
 */
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
    <header className={clsx('flex flex-col gap-3 pb-4', className)}>
      <div className="flex items-center justify-between gap-3">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav className="no-scrollbar flex min-w-0 overflow-x-auto" aria-label="Breadcrumb">
            <ol role="list" className="flex items-center space-x-1.5 whitespace-nowrap">
              {breadcrumbs.map((crumb, idx) => (
                <li key={crumb.label}>
                  <div className="flex items-center">
                    {idx > 0 && (
                      <span aria-hidden="true" className="mr-1.5 text-zinc-700">
                        /
                      </span>
                    )}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="-mx-1 -my-2 inline-flex items-center rounded px-1 py-2 text-xs text-zinc-500 outline-offset-2 transition-colors hover:text-white"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-xs text-zinc-300" aria-current="page">
                        {crumb.label}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </nav>
        ) : (
          <div />
        )}

        {environment ? (
          <span className="shrink-0 text-[10px] font-medium uppercase tracking-widest text-zinc-600">
            {environment}
          </span>
        ) : null}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <Heading className="tracking-tight">{title}</Heading>
            {live ? (
              <Badge color="accent" className="uppercase tracking-widest">
                <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-400 motion-safe:animate-pulse" />
                Live
              </Badge>
            ) : null}
          </div>
          {description ? <Text className="mt-1.5 max-w-3xl tracking-tight">{description}</Text> : null}
        </div>

        {actions ? <div className="flex shrink-0 items-center gap-3">{actions}</div> : null}
      </div>

      {filters ? <div className="flex items-center gap-4">{filters}</div> : null}
    </header>
  )
}
