import {
  BeakerIcon,
  CodeBracketSquareIcon,
  NoSymbolIcon,
  ShieldExclamationIcon,
  SignalSlashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import type { ActionItem, ActionItemKind } from '@/lib/agent-mission-control/dashboard-overview'

function isExternalHref(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://')
}

/** One glyph per action kind — shape carries the meaning, color stays quiet zinc. */
const KIND_ICON: Record<ActionItemKind, React.ComponentType<React.ComponentProps<'svg'>>> = {
  ready_manual: BeakerIcon,
  sandbox_failed: XCircleIcon,
  release_gate_red: ShieldExclamationIcon,
  pr_open: CodeBracketSquareIcon,
  mission_blocked: NoSymbolIcon,
  data_unavailable: SignalSlashIcon,
}

function ActionRow({ item }: { item: ActionItem }) {
  const Icon = KIND_ICON[item.kind]
  const external = isExternalHref(item.href)

  return (
    <li className="group flex gap-3 px-6 py-4 transition-colors duration-150 hover:bg-white/2.5">
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-zinc-500 transition-colors duration-150 group-hover:text-zinc-400"
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</p>
          <Badge color={item.kind === 'ready_manual' ? 'accent' : 'zinc'} className="shrink-0">
            {item.status}
          </Badge>
        </div>
        <p className="mt-1 truncate font-mono text-xs text-zinc-500">{item.meta}</p>
        <div className="mt-3">
          {external ? (
            <Button outline href={item.href} target="_blank" rel="noreferrer" className="min-h-11 w-full sm:w-auto">
              {item.buttonLabel}
            </Button>
          ) : (
            <Button outline href={item.href} className="min-h-11 w-full sm:w-auto">
              {item.buttonLabel}
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

export function ActionCenter({ items }: { items: ActionItem[] }) {
  return (
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader
        title="Requires Attention"
        meta={
          items.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-zinc-500">{items.length} open</span>
          ) : undefined
        }
      />
      {items.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {items.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <EmptyState title="All clear" className="py-16" />
      )}
    </SurfaceCard>
  )
}
