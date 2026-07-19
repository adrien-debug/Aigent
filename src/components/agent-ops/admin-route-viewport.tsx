'use client'

import type { ReactNode } from 'react'

/**
 * Padding shell for the admin page slot.
 *
 * Soft-nav loading is handled by `src/app/admin/loading.tsx` (Suspense).
 * Do not cache or conditionally unmount `children` here — hiding the live
 * App Router slot prevents the new RSC tree from landing, which left the UI
 * stuck on a placeholder after client navigations.
 */
export function AdminRouteViewport({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-6 lg:p-8 w-full">
      {children}
    </div>
  )
}
