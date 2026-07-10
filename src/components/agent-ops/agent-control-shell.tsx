'use client'

import { Cog6ToothIcon, CpuChipIcon, FolderIcon } from '@heroicons/react/20/solid'
import { usePathname } from 'next/navigation'
import { Avatar } from '@/components/catalyst/avatar'
import { Navbar, NavbarLabel, NavbarSection, NavbarSpacer } from '@/components/catalyst/navbar'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
  SidebarSpacer,
} from '@/components/catalyst/sidebar'
import { SidebarLayout } from '@/components/catalyst/sidebar-layout'

/** Mission-control reticle mark — inline SVG, no external asset. */
function LogoMark() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="size-5 text-zinc-950 dark:text-white">
      <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.5" opacity="0.6" />
      <circle cx="12" cy="12" r="2.25" fill="currentColor" />
      <path
        d="M12 1.75v3.25M12 19v3.25M1.75 12H5M19 12h3.25"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

// Traces global retiré : les traces vivent au niveau copilote (Runs) et par
// projet (menu Traces de chaque projet) — directive Adrien 2026-07-10.
const PLATFORM_ITEMS = [
  { label: 'Projects', icon: FolderIcon, href: '/admin/projects' },
  { label: 'Settings', icon: Cog6ToothIcon, href: '/admin/settings' },
] as const

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const copilotsCurrent = pathname === '/admin/agents' || pathname.startsWith('/admin/agents/')

  return (
    <SidebarLayout
      navbar={
        <Navbar>
          <NavbarSection>
            <LogoMark />
            <NavbarLabel className="text-sm font-semibold text-zinc-950 dark:text-white">Agent Mission Control</NavbarLabel>
          </NavbarSection>
          <NavbarSpacer />
        </Navbar>
      }
      sidebar={
        <Sidebar>
          <SidebarHeader>
            <div className="flex items-center gap-3 px-2 py-1">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-950/5 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
                <LogoMark />
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-zinc-950 dark:text-white">Agent Mission Control</div>
                <div className="truncate text-xs text-zinc-500">Copilot operations</div>
              </div>
            </div>
          </SidebarHeader>

          <SidebarBody>
            <SidebarSection>
              <SidebarItem href="/admin/agents" current={copilotsCurrent}>
                <CpuChipIcon data-slot="icon" />
                <SidebarLabel>Copilots</SidebarLabel>
              </SidebarItem>
            </SidebarSection>

            <SidebarSection>
              <SidebarHeading>Platform</SidebarHeading>
              {PLATFORM_ITEMS.map(({ label, icon: Icon, href }) => (
                <SidebarItem key={label} href={href} current={pathname.startsWith(href)}>
                  <Icon data-slot="icon" />
                  <SidebarLabel>{label}</SidebarLabel>
                </SidebarItem>
              ))}
            </SidebarSection>

            <SidebarSpacer />
          </SidebarBody>

          <SidebarFooter>
            <div className="flex items-center gap-3 px-2 py-1">
              <Avatar initials="AD" alt="" className="size-8 shrink-0 bg-zinc-800 text-white" />
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-zinc-950 dark:text-white">Adrien</div>
                <div className="truncate text-xs text-zinc-500">Platform Admin</div>
              </div>
            </div>
          </SidebarFooter>
        </Sidebar>
      }
    >
      {children}
    </SidebarLayout>
  )
}
