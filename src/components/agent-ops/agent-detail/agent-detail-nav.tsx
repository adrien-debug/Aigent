'use client'

import clsx from 'clsx'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from '@/components/ui/link'

/**
 * The canonical agent sections (AIGENT-AGENT-PAGES-021).
 *
 * Replaces the legacy Overview/Manifest/Quality/Runs/Improve/Release row, which
 * was organised around the engineering lifecycle rather than around operating
 * an agent. Manifest split into Configuration + Instructions; Quality and Tests
 * collapsed into Observability.
 *
 * Evolution and Release came back (AIGENT-OPERATOR-RESTORE-028) because folding
 * them into Observability made an operator surface read like a monitoring one:
 * Observability answers "what did this agent do", Evolution "how do I make it
 * better", Release "may this version ship". Those are three decisions, not one
 * dashboard.
 */
const SECTIONS = [
  { label: 'Overview', segment: '' },
  { label: 'Runs', segment: 'runs' },
  { label: 'Tools', segment: 'tools' },
  { label: 'Configuration', segment: 'configuration' },
  { label: 'Instructions', segment: 'instructions' },
  { label: 'Observability', segment: 'observability' },
  { label: 'Evolution', segment: 'evolution' },
  { label: 'Release', segment: 'release' },
] as const

export function AgentDetailNav({ copilotId }: { copilotId: string }) {
  const pathname = usePathname()
  const base = `/admin/agents/${copilotId}`
  const trackRef = useRef<HTMLElement | null>(null)
  // Which ends are still hidden. `no-scrollbar` removes the only native hint
  // that the row continues, and eight sections overflow a 390px viewport
  // (measured: 551px of links in a 343px track) — without an affordance the
  // last tabs simply do not exist for a phone user. Two booleans instead of
  // one so the fade never lingers on an edge that is already reached.
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const syncOverflow = useCallback(() => {
    const el = trackRef.current
    if (!el) return
    // 1px tolerance: fractional layout widths make scrollLeft land just shy of
    // the end and would otherwise pin the fade permanently.
    const maxScroll = el.scrollWidth - el.clientWidth
    setOverflow({ start: el.scrollLeft > 1, end: maxScroll - el.scrollLeft > 1 })
  }, [])

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    syncOverflow()
    // ResizeObserver, not a window resize listener: the track also changes width
    // when the sidebar collapses, which fires no window resize.
    const observer = new ResizeObserver(syncOverflow)
    observer.observe(el)
    return () => observer.disconnect()
  }, [syncOverflow])

  return (
    // The hairline lives on this wrapper, not on the scroll track, so it spans
    // the full width even when the row is narrower than the viewport — and so
    // it does not scroll away with the links. `relative` anchors the two edge
    // fades over the track.
    <div className="relative -mb-px border-b border-zinc-950/10 dark:border-white/10">
      <nav
        ref={trackRef}
        onScroll={syncOverflow}
        aria-label="Agent sections"
        className="no-scrollbar overflow-x-auto"
      >
        <div className="flex w-max min-w-full gap-6">
          {SECTIONS.map(({ label, segment }) => {
            const href = segment ? `${base}/${segment}` : base
            const current = segment ? pathname === href || pathname.startsWith(`${href}/`) : pathname === base
            return (
              <Link
                key={label}
                href={href}
                aria-current={current ? 'page' : undefined}
                className={clsx(
                  'shrink-0 border-b-2 px-1 py-3 text-sm font-medium whitespace-nowrap transition-colors',
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

      {/* Scroll affordance, rendered only on the side that is actually hidden.
          `aria-hidden` because it carries no information the links don't: they
          stay in the tab order, and focusing one scrolls it into view. The
          gradient is the page ground (zinc-950 dark / white light), so the
          labels dissolve into the edge instead of being cut mid-glyph. */}
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
