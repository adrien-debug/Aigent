import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import type { ActionItem } from '@/lib/agent-mission-control/dashboard-overview'

function isExternalHref(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://')
}

export function ActionCenter({ items }: { items: ActionItem[] }) {
  return (
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader title="Requires Attention" />
      {items.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {items.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 px-6 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</p>
                  <Badge color={item.kind === 'ready_manual' ? 'accent' : 'zinc'} className="shrink-0">
                    {item.status}
                  </Badge>
                </div>
                <p className="mt-1 truncate text-xs text-zinc-500">{item.meta}</p>
              </div>
              {isExternalHref(item.href) ? (
                <Button outline href={item.href} target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                  {item.buttonLabel}
                </Button>
              ) : (
                <Button outline href={item.href} className="w-full sm:w-auto">
                  {item.buttonLabel}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="All clear" className="py-16" />
      )}
    </SurfaceCard>
  )
}
