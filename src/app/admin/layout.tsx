import { CommandPalette } from '@/components/agent-ops/command-palette'
import { AigentSidebar } from '@/components/agent-ops/aigent-sidebar'
import { Navbar, NavbarSection, NavbarSpacer } from '@/components/catalyst/navbar'
import { SidebarLayout } from '@/components/catalyst/sidebar-layout'
import { Avatar } from '@/components/catalyst/avatar'

// Live-only: every /admin route renders per-request against the gpu1 data layer.
// Force dynamic so `next build` never prerenders them (the fail-closed data layer
// would throw without a backend, e.g. in CI).
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <CommandPalette />
      <SidebarLayout
        navbar={
          <Navbar>
            <NavbarSpacer />
            <NavbarSection>
              <Avatar
                initials="AD"
                alt="Adrien"
                className="size-8 bg-zinc-800 text-white text-[11px] font-medium ring-1 ring-white/10"
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
