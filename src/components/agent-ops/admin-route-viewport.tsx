'use client'

import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useRef } from 'react'

/**
 * Padding + scroll shell for the admin page slot.
 *
 * Owns vertical scroll (main is overflow-hidden). Document pages grow and
 * scroll here from scrollTop 0; fill-height pages (team canvas, builder) set
 * their own `flex-1 min-h-0` and scroll internally.
 *
 * Resets scroll on pathname change — this shell lives in the admin layout and
 * would otherwise keep scrollTop across soft navigations (Performance looked
 * like it was missing its header/KPIs).
 *
 * `[--gutter]` defaults for Catalyst `Table` bleed (`-mx-(--gutter)`). In-card
 * tables should override with `[--gutter:--spacing(0)]`.
 *
 * Soft-nav loading is handled by `src/app/admin/loading.tsx` (Suspense).
 * Do not cache or conditionally unmount `children` here — hiding the live
 * App Router slot prevents the new RSC tree from landing, which left the UI
 * stuck on a placeholder after client navigations.
 */
export function AdminRouteViewport({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const scrollerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, left: 0 })
  }, [pathname])

  return (
    <div
      ref={scrollerRef}
      className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto p-6 lg:p-8 [--gutter:--spacing(6)]"
    >
      {children}
    </div>
  )
}
