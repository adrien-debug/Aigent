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
import { StatusPill } from '@/components/agent-ops/status-pill'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
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

function ActionRow({ item, focus }: { item: ActionItem; focus: boolean }) {
  const Icon = KIND_ICON[item.kind]
  const external = isExternalHref(item.href)
  const tone: 'accent' | 'zinc' = ACCENT_KINDS.has(item.kind) ? 'accent' : 'zinc'
  const linkProps = external ? { target: '_blank', rel: 'noreferrer' } : {}

  return (
    <li
      className={clsx(
        'group flex gap-3 px-6 py-4 transition-colors duration-150 hover:bg-white/2.5',
        focus && 'border-l-2 border-accent-500/40 ps-5'
      )}
    >
      <Icon
        aria-hidden="true"
        className="mt-0.5 size-5 shrink-0 text-zinc-500 transition-colors duration-150 group-hover:text-zinc-400"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-sm font-medium text-white">{item.title}</p>
          <StatusPill label={item.status} tone={tone} />
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate font-mono text-xs text-zinc-500">{item.meta}</p>
          <Button
            plain
            href={item.href}
            aria-label={`${item.buttonLabel}: ${item.title}`}
            className="shrink-0"
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
        meta={
          sorted.length > 0 ? (
            <span className="font-mono text-xs tabular-nums text-zinc-500">{sorted.length} open</span>
          ) : undefined
        }
      />
      {sorted.length > 0 ? (
        <ul className="divide-y divide-white/5">
          {sorted.map((item, i) => (
            <ActionRow key={item.id} item={item} focus={i === 0} />
          ))}
        </ul>
      ) : (
        <EmptyState title="All clear" className="py-12" />
      )}
    </SurfaceCard>
  )
}
