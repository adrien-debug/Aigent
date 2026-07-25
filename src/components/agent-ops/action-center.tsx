import {
  BeakerIcon,
  ChevronRightIcon,
  CodeBracketSquareIcon,
  NoSymbolIcon,
  ShieldExclamationIcon,
  SignalSlashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/ui/badge'
import { Link } from '@/components/ui/link'
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

/** Kinds where the severity earns the accent dot; everything else recedes to zinc. */
const ACCENT_KINDS = new Set<ActionItemKind>(['ready_manual', 'mission_blocked', 'release_gate_red'])

function ActionRow({ item }: { item: ActionItem }) {
  const Icon = KIND_ICON[item.kind]
  const external = isExternalHref(item.href)
  const tone: 'accent' | 'zinc' = ACCENT_KINDS.has(item.kind) ? 'accent' : 'zinc'
  const linkProps = external ? { target: '_blank', rel: 'noreferrer' } : {}

  return (
    <li className="group grid min-h-14 grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 transition-colors duration-150 hover:bg-[var(--color-surface-focus)]">
      <Icon
        aria-hidden="true"
        className="size-5 text-zinc-400 transition-colors duration-150 group-hover:text-zinc-500"
      />
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900 dark:text-white">{item.title}</p>
          <Badge color={tone} className="uppercase tracking-widest">
            {item.status}
          </Badge>
        </div>
        <p className="min-w-0 truncate font-mono text-xs text-zinc-500">{item.meta}</p>
      </div>
      <Link
        href={item.href}
        aria-label={`${item.buttonLabel}: ${item.title}`}
        className="inline-flex h-7 shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs font-medium text-zinc-400 hover:bg-zinc-950/5 hover:text-zinc-900 dark:hover:text-white"
        {...linkProps}
      >
        {item.buttonLabel}
        <ChevronRightIcon className="size-3.5" aria-hidden="true" />
      </Link>
    </li>
  )
}

export function ActionCenter({ items }: { items: ActionItem[] }) {
  const sorted = [...items].sort((a, b) => a.priority - b.priority)

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Requires Attention"
        density="compact"
        meta={
          sorted.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-zinc-500">{sorted.length} open</span>
          ) : undefined
        }
      />
      {sorted.length > 0 ? (
        <ul className="divide-y divide-zinc-950/5 border-t border-zinc-950/5">
          {sorted.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <EmptyState title="All clear" className="py-12" />
      )}
    </SurfaceCard>
  )
}
