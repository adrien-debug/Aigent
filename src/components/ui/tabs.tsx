'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Link } from './link'

/**
 * Canonical tab-nav primitive — extracted from two near-identical
 * implementations (`ProjectTabs` in project-tabs.tsx, `AgentDetailNav` in
 * agent-detail/agent-detail-nav.tsx). Both were the same grammar: a hairline
 * underline on the nav, an accent underline + `aria-current` on the active
 * tab, horizontal scroll INSIDE the bounded track (never the page body).
 * `AgentDetailNav` additionally faded the two scroll edges when its 8 tabs
 * overflowed a phone viewport — folded in here as `scrollAffordance`, opt-in
 * so a short tab row (e.g. 3 items) does not pay for logic it never needs.
 *
 * Route matching is Next-`Link`-based (`pathname === href ||
 * pathname.startsWith(href + '/')`), same as both originals — a tab whose
 * `segment` names a route that does not exist is a 404 generator, so callers
 * must only list routes that are real.
 */
export type TabItem = {
  label: string
  /** Path segment appended to `base`; '' means the base route itself. */
  segment: string
}

export function Tabs({
  items,
  base,
  ariaLabel,
  scrollAffordance = false,
  className,
}: {
  items: readonly TabItem[]
  /** Route prefix every tab's `href` is built from: `${base}/${segment}`. */
  base: string
  /** Accessible name for the `<nav>` — must describe WHAT is being switched
   * (e.g. "Project sections"), distinct across tab groups on the same page so
   * two `Tabs` instances never read as one to assistive tech. */
  ariaLabel: string
  /** Fade the scroll edges that are actually hidden. Needed once a tab row
   * can overflow its viewport (agent detail's 8 sections); skip it for a
   * row that always fits (project's 3). */
  scrollAffordance?: boolean
  className?: string
}) {
  // Unique per mounted instance — guards against a FUTURE `layoutId`-based
  // active-tab indicator colliding when two Tabs groups render on one page
  // (e.g. a master/detail layout). Not consumed by the current underline
  // implementation (a plain border, no motion), reserved for that case.
  const groupId = useId()
  const pathname = usePathname()
  const trackRef = useRef<HTMLElement | null>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const syncOverflow = useCallback(() => {
    if (!scrollAffordance) return
    const el = trackRef.current
    if (!el) return
    const maxScroll = el.scrollWidth - el.clientWidth
    setOverflow({ start: el.scrollLeft > 1, end: maxScroll - el.scrollLeft > 1 })
  }, [scrollAffordance])

  useEffect(() => {
    if (!scrollAffordance) return
    const el = trackRef.current
    if (!el) return
    syncOverflow()
    const observer = new ResizeObserver(syncOverflow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [scrollAffordance, syncOverflow])

  const nav = (
    <nav
      ref={trackRef}
      onScroll={scrollAffordance ? syncOverflow : undefined}
      aria-label={ariaLabel}
      data-tabs-group={groupId}
      className={clsx('no-scrollbar overflow-x-auto', !scrollAffordance && '-mb-px border-b border-zinc-950/10 dark:border-white/10')}
    >
      <div className="flex w-max min-w-full gap-6">
        {items.map(({ label, segment }) => {
          const href = segment ? `${base}/${segment}` : base
          const current = segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
          return (
            <Link
              key={label}
              href={href}
              aria-current={current ? 'page' : undefined}
              className={clsx(
                'shrink-0 border-b-2 px-2 py-3 text-sm font-medium whitespace-nowrap transition-colors sm:px-1',
                'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-500',
                current
                  ? 'border-accent-500 text-zinc-950 dark:text-white'
                  : 'border-transparent text-zinc-500 hover:border-zinc-950/20 hover:text-zinc-700 dark:text-zinc-400 dark:hover:border-white/20 dark:hover:text-zinc-200'
              )}
            >
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )

  if (!scrollAffordance) {
    return <div className={className}>{nav}</div>
  }

  return (
    <div className={clsx('relative -mb-px border-b border-zinc-950/10 dark:border-white/10', className)}>
      {nav}
      {overflow.start ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent dark:from-zinc-950"
        />
      ) : null}
      {overflow.end ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-zinc-950"
        />
      ) : null}
    </div>
  )
}
