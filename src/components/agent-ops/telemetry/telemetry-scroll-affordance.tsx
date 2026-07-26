'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * TelemetryScrollAffordance — edge fades for a horizontally scrolling table.
 *
 * These two tables carry 6 and 7 `whitespace-nowrap` columns and overflow well
 * before a 1024px viewport, so part of every row lives off-screen on a laptop.
 * A native scrollbar is NOT an affordance here: macOS paints overlay bars that
 * stay invisible until a scroll gesture already started, so a reader who never
 * flicks the trackpad has no way to learn the row continues. The previous
 * `no-scrollbar` was worse still — it removed even the after-the-fact hint.
 *
 * Same contract as `agent-detail/agent-detail-nav.tsx` (two booleans, 1px
 * tolerance, ResizeObserver rather than a window listener because the sidebar
 * collapse resizes the track without firing a window resize), lifted to wrap a
 * SERVER-rendered table: only this shell crosses the client boundary, the
 * tables themselves stay server components.
 *
 * The scrollport is NOT created here. `Table` already owns an `overflow-x-auto`
 * div and spreads its extra props onto that exact element, so the caller tags
 * it `data-scrollport` and this wrapper looks it up once. Wrapping a second
 * scroll container around it would nest two scrollports and make the outer one
 * unreachable.
 */
export function TelemetryScrollAffordance({ children }: { children: React.ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [overflow, setOverflow] = useState({ start: false, end: false })

  const syncOverflow = useCallback((el: HTMLElement) => {
    // 1px tolerance: fractional layout widths make scrollLeft land just shy of
    // the end and would otherwise pin the end fade permanently.
    const maxScroll = el.scrollWidth - el.clientWidth
    setOverflow({ start: el.scrollLeft > 1, end: maxScroll - el.scrollLeft > 1 })
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const track = host.querySelector<HTMLElement>('[data-scrollport]')
    if (!track) return

    const handler = () => syncOverflow(track)
    handler()
    track.addEventListener('scroll', handler, { passive: true })
    const observer = new ResizeObserver(handler)
    observer.observe(track)
    // The track's own box stops changing once the card is laid out, but its
    // CONTENT width still moves when a row's longest cell re-renders (live
    // refresh replaces the event list every few seconds), so observe the
    // measured table too — otherwise the fade survives a shrink to no-overflow.
    const table = track.querySelector('table')
    if (table) observer.observe(table)

    return () => {
      track.removeEventListener('scroll', handler)
      observer.disconnect()
    }
  }, [syncOverflow])

  return (
    <div ref={hostRef} className="relative">
      {children}
      {/* Rendered only on the side actually hidden, and `aria-hidden` because it
          carries nothing the cells don't: every link stays in the tab order and
          focusing one scrolls it into view. The gradient is the RAISED plane the
          table sits on (white light / #1a1a1e dark), so glyphs dissolve into the
          edge instead of being sliced mid-character. `inset-y-px` keeps the card
          ring visible under the fade. */}
      {overflow.start ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-px left-0 w-8 bg-gradient-to-r from-white to-transparent dark:from-surface-raised"
        />
      ) : null}
      {overflow.end ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-px right-0 w-8 bg-gradient-to-l from-white to-transparent dark:from-surface-raised"
        />
      ) : null}
    </div>
  )
}
