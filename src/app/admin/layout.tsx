import { cookies } from 'next/headers'

import { AdminRail } from '@/components/admin-shell/admin-rail'
import { AdminTopbar } from '@/components/admin-shell/admin-topbar'
import { SidebarLayout } from '@/components/ui/sidebar-layout'
import { SESSION_COOKIE, decodeSession } from '@/lib/agent-mission-control/auth'

// Live-only: every /admin route renders per-request against the gpu1 data layer.
// Force dynamic so `next build` never prerenders them (the fail-closed data layer
// would throw without a backend, e.g. in CI).
export const dynamic = 'force-dynamic'

/**
 * The admin shell, REBUILT in P004.
 *
 * It replaces `components/shell/*` — `aigent-sidebar` (the old rail),
 * `command-palette`, and the `page-layout`/`page-header` wrappers. The rail is
 * now the Catalyst `Sidebar` primitives directly, and the topbar owns the ONE
 * global search field, which lives in the URL rather than in component state.
 *
 * The avatar no longer hard-codes "AD"/"Adrien": the admin session carries no
 * name (see `auth.ts` → `AdminSession`), so the shell shows the role it can
 * prove and nothing else.
 *
 * NO `loading.tsx` ABOVE THIS SUBTREE — the rule predates P004 and still holds.
 * A `loading.tsx` is a Suspense boundary, and Next reuses the NEAREST one for
 * every descendant, so a boundary here lets React flush the HTML shell with
 * `200 OK` before `[id]` has resolved: every `notFound()` below then paints its
 * 404 inside an already-committed 200. Measured twice — once on the 404 path
 * (9 deep links answered 200 instead of 404), once on the error path in P003
 * (a total backend failure answered 200 with a skeleton instead of 500).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const store = await cookies()
  const session = decodeSession(store.get(SESSION_COOKIE)?.value)

  return (
    // The topbar is rendered ONCE, at the top of the content column, because
    // `SidebarLayout` only shows its `navbar` slot below `lg` — passing it
    // there AND rendering it here would put two search fields in the DOM at
    // every width, one merely hidden by CSS. The slot keeps a spacer so the
    // mobile header still carries its burger button.
    <SidebarLayout navbar={<div className="min-w-0 flex-1" />} sidebar={<AdminRail />}>
      <div className="flex flex-col gap-6">
        <AdminTopbar
          nowIso={new Date().toISOString()}
          viewerRole={session?.role ?? null}
          authenticated={session !== null}
        />
        {children}
      </div>
    </SidebarLayout>
  )
}
