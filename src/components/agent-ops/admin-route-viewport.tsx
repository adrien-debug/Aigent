'use client'

import { usePathname } from 'next/navigation'
import { useState, type ReactNode } from 'react'

/**
 * Single admin route surface. On client navigation the App Router can briefly
 * keep the previous route's RSC tree in `children` while the URL already
 * changed — that reads as two full pages stacked (Fleet Performance + Dashboard).
 * Hide stale children as soon as pathname changes; show them again only once
 * the server stream for the new route has landed.
 */
export function AdminRouteViewport({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [committedPath, setCommittedPath] = useState(pathname)
  const [committedChildren, setCommittedChildren] = useState(children)

  // Commit during render when the server stream for the new route lands.
  if (children !== committedChildren) {
    setCommittedPath(pathname)
    setCommittedChildren(children)
  }

  const transitioning = pathname !== committedPath

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6 lg:p-8 w-full">
      {transitioning ? <RoutePlaceholder /> : <div key={committedPath}>{committedChildren}</div>}
    </div>
  )
}

function RoutePlaceholder() {
  return (
    <div aria-busy="true" aria-live="polite" className="flex flex-col gap-8 pb-12">
      <span className="sr-only">Loading…</span>
      <div className="h-44 motion-safe:animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
      <div className="h-96 motion-safe:animate-pulse rounded-2xl border border-white/5 bg-white/[0.02]" />
    </div>
  )
}
