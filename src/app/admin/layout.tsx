import { CommandPalette } from '@/components/shell/command-palette'
import { AigentSidebar } from '@/components/shell/aigent-sidebar'
import { Navbar, NavbarSection, NavbarSpacer } from '@/components/ui/navbar'
import { SidebarLayout } from '@/components/ui/sidebar-layout'
import { Avatar } from '@/components/ui/avatar'
import { metaTextClass } from '@/components/ui/text'

// Live-only: every /admin route renders per-request against the gpu1 data layer.
// Force dynamic so `next build` never prerenders them (the fail-closed data layer
// would throw without a backend, e.g. in CI).
export const dynamic = 'force-dynamic'

/**
 * NO `loading.tsx` ABOVE A DYNAMIC SEGMENT — read this before adding one.
 *
 * A `loading.tsx` is a Suspense boundary, and Next.js reuses the NEAREST one for
 * every descendant. A boundary placed here (or at `agents/`, `projects/`, …)
 * therefore lets React flush the HTML shell with `200 OK` before `[id]` has
 * resolved, which permanently locks the status line: every `notFound()` below —
 * `agents/[id]/layout.tsx`, `getProjectDetailPageData` — then paints its 404 UI
 * inside an already committed 200 response. Measured on a dev server before the
 * fix: all 9 deep links out of /admin/telemetry that point at retired ids
 * answered 200 with a "not found" body, i.e. no monitor, crawler or API client
 * could tell an absent agent from an empty page. Removing the subtree boundary
 * turned exactly those 9 into 404 while every live route stayed 200.
 *
 * A skeleton is therefore only legal on a segment with NO dynamic segment below
 * it (`settings/` qualifies; `projects/` does not). Wrapping the index alone in
 * a `(overview)` route group would also work — it was tried and dropped because
 * the skeleton it carried mirrored nothing: 726px against a 1451px page, 4 KPI
 * tiles against 5, three whole row-blocks absent. A fallback that jumps 725px
 * when the data lands is worse than no fallback.
 */

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommandPalette />
      <SidebarLayout
        navbar={
          // Second `navigation` landmark of the shell, next to the sidebar
          // rail (labelled "Main"). It carries the account affordance only, so
          // it is named for what it holds — the two are told apart in a screen
          // reader's landmark list instead of both reading "navigation".
          <Navbar aria-label="Account">
            <NavbarSpacer />
            <NavbarSection>
              <Avatar
                initials="AD"
                alt="Adrien"
                className={`size-8 bg-zinc-800 text-white ${metaTextClass} font-medium ring-1 ring-white/10`}
              />
            </NavbarSection>
          </Navbar>
        }
        sidebar={<AigentSidebar />}
      >
        {children}
      </SidebarLayout>
    </>
  )
}
