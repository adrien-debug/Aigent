import { CommandPalette } from '@/components/shell/command-palette'
import { AigentSidebar } from '@/components/shell/aigent-sidebar'
import { Navbar, NavbarSection, NavbarSpacer } from '@/components/ui/navbar'
import { SidebarLayout } from '@/components/ui/sidebar-layout'
import { Avatar } from '@/components/ui/avatar'

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
