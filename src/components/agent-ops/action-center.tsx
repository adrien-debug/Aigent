import {
  BeakerIcon,
  ChevronRightIcon,
  CodeBracketSquareIcon,
  NoSymbolIcon,
  ShieldExclamationIcon,
  SignalSlashIcon,
  XCircleIcon,
} from '@heroicons/react/24/outline'
import clsx from 'clsx'

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

/** Kinds where the severity earns the accent dot; everything else recedes to zinc. */
const ACCENT_KINDS = new Set<ActionItemKind>(['ready_manual', 'mission_blocked', 'release_gate_red'])

function ActionRow({ item }: { item: ActionItem }) {
  const Icon = KIND_ICON[item.kind]
  const external = isExternalHref(item.href)
  const tone: 'accent' | 'zinc' = ACCENT_KINDS.has(item.kind) ? 'accent' : 'zinc'
  const linkProps = external ? { target: '_blank', rel: 'noreferrer' } : {}

  return (
    <li
      className="group flex gap-3 px-4 py-3 border-b border-zinc-200 last:border-b-0 transition-colors duration-150 hover:bg-[var(--color-surface-focus)]"
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-zinc-400 transition-colors duration-150 group-hover:text-zinc-500"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">{item.title}</p>
          <Badge color={tone} className="uppercase tracking-widest">
            {item.status}
          </Badge>
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-mono text-xs text-zinc-500">{item.meta}</p>
          <Button
            plain
            href={item.href}
            aria-label={`${item.buttonLabel}: ${item.title}`}
            className="shrink-0 text-zinc-600 hover:text-zinc-900"
            {...linkProps}
          >
            {item.buttonLabel}
            <ChevronRightIcon data-slot="icon" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </li>
  )
}

export function ActionCenter({ items }: { items: ActionItem[] }) {
  const sorted = [...items].sort((a, b) => a.priority - b.priority)

  return (
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader
        title="Requires Attention"
        className="px-4 pt-3 pb-2"
        meta={
          sorted.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-zinc-500">{sorted.length} open</span>
          ) : undefined
        }
      />
      {sorted.length > 0 ? (
        <ul className="flex flex-col pb-2">
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
