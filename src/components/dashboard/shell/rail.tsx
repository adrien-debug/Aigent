import { HomeIcon, QueueListIcon } from '@heroicons/react/24/outline'
import type React from 'react'

import { cn } from '@/components/ui/cn'
import { Link } from '@/components/ui/link'

/**
 * The navigation rail of the admin console — a SERVER component: no state, no
 * data fetch, no client boundary. It receives the current path and renders.
 *
 * IT SHOWS TWO ITEMS BECAUSE TWO ROUTES EXIST. `/admin` and `/admin/runs` are
 * the whole console today; `src/app/admin/{agents,projects,factory,settings}`
 * are forbidden by `scripts/check-no-legacy-front.mjs` and genuinely do not
 * exist. The previous pass drew the "full stack" as dimmed, inert icons —
 * REMOVED, on the operator's explicit instruction. A greyed glyph is a promise
 * the build cannot keep, and a tall rail holding two honest items is correct.
 * Add the route first, then add the item here.
 *
 * LAYOUT CONTRACT (the page owns the frame, this file owns the rail):
 *
 *   <div className="flex min-h-dvh flex-col bg-app">
 *     <Topbar degraded={…} executableNow={…} executableTotal={…} />
 *     <div className="flex min-w-0 flex-1 flex-col md:flex-row">
 *       <Rail activeHref="/admin" />
 *       <main className="min-w-0 flex-1">…</main>
 *     </div>
 *   </div>
 *
 * The rail is an in-flow flex item — never `fixed`, so no ancestor has to guess
 * a compensating padding. Below 768px it is a horizontal strip stuck directly
 * under the 56px top bar (`top-14`); from 768px up, the same element is a 64px
 * column sticky beside the content. One markup tree, 100% CSS: no hamburger,
 * no JS, no second component.
 */

type RailItem = {
  /** A route that EXISTS. Nothing else belongs in this list. */
  href: string
  /** Visible in strip mode, the accessible name of the icon-only tile in rail mode. */
  label: string
  icon: React.ReactNode
}

const ICON = 'size-5 shrink-0'

const NAV_ITEMS: readonly RailItem[] = [
  {
    href: '/admin',
    label: 'Tableau de bord',
    icon: <HomeIcon aria-hidden="true" className={ICON} />,
  },
  {
    href: '/admin/runs',
    label: 'Runs',
    icon: <QueueListIcon aria-hidden="true" className={ICON} />,
  },
]

/**
 * One rail row.
 *
 * The `<li>` is the positioning context, not the tile: in column mode the `li`
 * spans the rail's full 64px, so the active marker lands on the RAIL's own edge
 * instead of 12px inside it, where it reads as a stray dash.
 *
 * The label is a real, visible word in strip mode and collapses to `md:sr-only`
 * in column mode — the icon-only tile keeps an accessible name without a second
 * markup branch.
 */
function RailTile({ item, active }: { item: RailItem; active: boolean }) {
  return (
    <li className="relative flex shrink-0 justify-center md:w-full">
      {active ? (
        <>
          {/* Strip mode: the marker follows the row, so it runs along the bottom. */}
          <span
            aria-hidden="true"
            className="absolute inset-x-1 bottom-0 h-0.5 rounded-full bg-accent-500 md:hidden"
          />
          {/* Column mode: the 2px accent bar on the rail's own left edge. */}
          <span
            aria-hidden="true"
            className="absolute inset-y-1 left-0 hidden w-0.5 rounded-full bg-accent-500 md:block"
          />
        </>
      ) : null}

      <Link
        href={item.href}
        title={item.label}
        aria-current={active ? 'page' : undefined}
        className={cn(
          // Strip: 40px-tall pill, icon + word. Column: 40px square, icon only.
          'flex h-10 min-w-0 items-center gap-2 rounded-lg px-3 text-xs font-medium transition-colors',
          'md:w-10 md:justify-center md:gap-0 md:px-0',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
          active
            ? 'bg-(--accent-surface) text-accent-300'
            : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200'
        )}
      >
        {item.icon}
        <span className="truncate md:sr-only">{item.label}</span>
      </Link>
    </li>
  )
}

export function Rail({
  activeHref,
}: {
  /** The current pathname. The active tile is the item whose `href` matches it. */
  activeHref: string
}) {
  return (
    <nav
      aria-label="Navigation principale"
      className={cn(
        // Strip (<768px): full-width bar, pinned under the 56px top bar.
        // `overflow-x-auto` is a safety net only — two items and the mark measure
        // ~290px, so nothing scrolls at 375px.
        'no-scrollbar sticky top-14 z-10 flex w-full shrink-0 flex-row items-center gap-2 overflow-x-auto border-b border-line bg-rail px-3 py-2',
        // Column (>=768px): the 64px rail, hairline on the right, viewport tall
        // minus the top bar it sits under. `self-start` is what lets a flex item
        // be sticky — stretched, it would have nowhere to travel.
        'md:h-[calc(100dvh-3.5rem)] md:w-16 md:flex-col md:gap-4 md:self-start md:overflow-x-visible md:overflow-y-auto md:border-r md:border-b-0 md:px-0 md:py-4'
      )}
    >
      {/* Brand mark. The name itself is spelled once, in the top bar. */}
      <div
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-500 text-sm font-bold text-zinc-950"
      >
        A
      </div>

      <ul className="flex min-w-0 grow flex-row items-center gap-1 md:w-full md:flex-col md:gap-2">
        {NAV_ITEMS.map((item) => (
          <RailTile key={item.href} item={item} active={item.href === activeHref} />
        ))}
      </ul>
    </nav>
  )
}
