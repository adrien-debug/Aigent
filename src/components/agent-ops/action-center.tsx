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

/**
 * Tone per kind. Three values, not two: the previous split was accent-vs-zinc,
 * which forced every "important" row into the accent — so `release_gate_red` and
 * `mission_blocked` came out in the brand GREEN, the only vivid badge in the
 * list, while `sandbox_failed` receded to zinc. The row shouting success was the
 * blocked one, and the actual failure was the quietest: priority order and
 * visual order said the opposite of each other.
 *
 * Now: a failure is danger, an action waiting on a human is accent, the rest is
 * zinc. `data_unavailable` stays zinc on purpose — an unmeasured dimension is an
 * absence, not a failure, and must never be dressed as one.
 */
const KIND_TONE: Record<ActionItemKind, 'accent' | 'danger' | 'zinc'> = {
  ready_manual: 'accent',
  sandbox_failed: 'danger',
  release_gate_red: 'danger',
  mission_blocked: 'danger',
  pr_open: 'zinc',
  data_unavailable: 'zinc',
}

function ActionRow({ item }: { item: ActionItem }) {
  const Icon = KIND_ICON[item.kind]
  const external = isExternalHref(item.href)
  const tone = KIND_TONE[item.kind] ?? 'zinc'
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
        {/* zinc-400: `check:contrast` measures zinc-500 at 3.59:1 on the raised
            card plane, under the 4.5 AA floor. This line carries the row's only
            identifying detail (project · repo), so it is the one an operator
            actually has to read to tell two otherwise identical rows apart. */}
        <p className="min-w-0 truncate font-mono text-xs text-zinc-400">{item.meta}</p>
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
            /* zinc-400 — measured 3.59:1 at zinc-500 on this plane (AA needs 4.5).
               This is the card's count, the header's only number. */
            <span className="font-mono text-xs tabular-nums text-zinc-400">{sorted.length} open</span>
          ) : undefined
        }
      />
      {/* `flex-1` on the body, both branches. `SurfaceCard` is a flex column and
          a grid item, so the CELL always stretches to the tallest card in the
          row — but the list did not, and the card's bottom edge sat 53px below
          the last divider (measured at 1440x900 on /admin: card 495→667, list
          547→614). One card in the pair painted a plane its content stopped
          short of; the other filled it. The hairline rules now reach the bottom
          edge in every state, so the two halves of the row read as one band.
          The `className="py-12"` that used to sit on the empty branch is gone:
          it merely restated the component's own default and pretended to be a
          choice — the real padding lever is the `padding` prop. */}
      {sorted.length > 0 ? (
        <ul className="flex-1 divide-y divide-zinc-950/5 border-t border-zinc-950/5">
          {sorted.map((item) => (
            <ActionRow key={item.id} item={item} />
          ))}
        </ul>
      ) : (
        <EmptyState title="All clear" className="flex-1" />
      )}
    </SurfaceCard>
  )
}
