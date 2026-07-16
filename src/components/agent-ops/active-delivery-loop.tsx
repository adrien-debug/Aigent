import clsx from 'clsx'
import { ExclamationTriangleIcon } from '@heroicons/react/20/solid'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import type { DeliveryLoopItem, DeliveryStepId, DeliveryStepState } from '@/lib/agent-mission-control/dashboard-overview'
import { formatTimestamp } from '@/lib/agent-mission-control/format'

const STEP_LABELS: Record<DeliveryStepId, string> = {
  build: 'Build',
  scorecard: 'Scorecard',
  pr: 'PR',
  sandbox: 'Sandbox',
  manual_test: 'Manual',
  merged: 'Merged',
}

const STEP_ORDER: DeliveryStepId[] = ['build', 'scorecard', 'pr', 'sandbox', 'manual_test', 'merged']

function StepPill({ label, state }: { label: string; state: DeliveryStepState }) {
  return (
    <span
      className={clsx(
        'rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ring-1',
        state === 'past' && 'bg-[var(--accent-soft)] text-accent-300 ring-[var(--accent-line)]',
        state === 'current' && 'bg-accent-500/20 text-accent-200 ring-accent-500/40 animate-pulse',
        state === 'pending' && 'bg-white/[0.02] text-zinc-600 ring-white/5',
        state === 'failed' && 'bg-white/[0.04] text-zinc-300 ring-white/15'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {state === 'failed' ? <ExclamationTriangleIcon aria-hidden="true" className="size-3 text-zinc-400" /> : null}
        {label}
      </span>
    </span>
  )
}

function DeliveryLoopRow({ item }: { item: DeliveryLoopItem }) {
  const href =
    item.source === 'mission' ? `/admin/projects/${item.agentId}` : `/admin/agents/${item.agentId}`

  return (
    <div className="flex flex-col gap-3 border-b border-white/5 px-6 py-4 last:border-b-0 hover:bg-white/[0.02] transition-colors">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={href} className="text-sm font-medium text-white hover:underline">
            {item.agentName}
          </Link>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{item.targetRepo ?? '—'}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge color={item.currentState.includes('merged') || item.currentState === 'completed' ? 'accent' : 'zinc'}>
            {item.currentState.replace(/_/g, ' ')}
          </Badge>
          <span className="font-mono text-[10px] text-zinc-600">{formatTimestamp(item.lastUpdate).replace(' UTC', '')}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STEP_ORDER.map((step) => (
          <StepPill key={step} label={STEP_LABELS[step]} state={item.steps[step]} />
        ))}
      </div>
    </div>
  )
}

export function ActiveDeliveryLoop({ items }: { items: DeliveryLoopItem[] }) {
  return (
    <SurfaceCard className="flex h-full flex-col">
      <SurfaceCardHeader title="Active Delivery Loop" />
      {items.length > 0 ? (
        <div className="flex-1 overflow-x-hidden">
          {items.map((item) => (
            <DeliveryLoopRow key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <EmptyState title="No active deliveries" className="py-16" />
      )}
    </SurfaceCard>
  )
}
