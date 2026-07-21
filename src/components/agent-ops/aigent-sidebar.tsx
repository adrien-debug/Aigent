'use client'

import {
  ChartBarIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  SignalIcon,
  Squares2X2Icon,
} from '@heroicons/react/20/solid'
import { ArrowRightStartOnRectangleIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'

import { Avatar } from '@/components/catalyst/avatar'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/catalyst/sidebar'

function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="570.6 464.9 133.3 146.8"
      fill="currentColor"
      aria-hidden="true"
      className={clsx(className)}
    >
      <polygon points="601.7 466.9 572.6 466.9 572.6 609.7 601.7 609.7 601.7 549.1 633.1 579.4 665.8 579.4 601.7 517.5 601.7 466.9" />
      <polygon points="672.7 466.9 672.7 528.1 644.6 500.9 612 500.9 672.7 559.7 672.7 609.7 701.9 609.7 701.9 466.9 672.7 466.9" />
    </svg>
  )
}

/**
 * Navigation sections. Every href is a route that EXISTS — a sidebar entry
 * pointing at a 404 is worse than a missing entry.
 */
const NAV_SECTIONS = [
  {
    heading: 'Operations',
    items: [
      { label: 'Dashboard', href: '/admin', icon: Squares2X2Icon, exact: true },
      { label: 'Projects', href: '/admin/projects', icon: RectangleStackIcon, exact: false },
      { label: 'Agents', href: '/admin/agents', icon: CpuChipIcon, exact: false },
    ],
  },
  {
    heading: 'Monitoring',
    items: [
      { label: 'Performance', href: '/admin/performance', icon: ChartBarIcon, exact: false },
      { label: 'Telemetry', href: '/admin/telemetry', icon: SignalIcon, exact: false },
    ],
  },
  {
    heading: 'System',
    items: [{ label: 'Settings', href: '/admin/settings', icon: Cog6ToothIcon, exact: false }],
  },
] as const

export function AigentSidebar() {
  const pathname = usePathname()

  const isCurrent = (href: string, exact: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(`${href}/`)

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-500 text-zinc-950">
            <LogoMark className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-950 dark:text-white">Aigent</div>
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">Agent Operations</div>
          </div>
        </div>

        <SidebarSection>
          <SidebarItem onClick={() => window.dispatchEvent(new Event('aigent:command-palette'))}>
            <MagnifyingGlassIcon data-slot="icon" />
            <SidebarLabel>Search</SidebarLabel>
          </SidebarItem>
        </SidebarSection>
      </SidebarHeader>

      <SidebarBody>
        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.heading}>
            <SidebarHeading>{section.heading}</SidebarHeading>
            {section.items.map((item) => (
              <SidebarItem key={item.href} href={item.href} current={isCurrent(item.href, item.exact)}>
                <item.icon data-slot="icon" />
                <SidebarLabel>{item.label}</SidebarLabel>
              </SidebarItem>
            ))}
          </SidebarSection>
        ))}
      </SidebarBody>

      <SidebarFooter>
        <SidebarSection>
          <SidebarItem href="/logout">
            <Avatar
              slot="avatar"
              initials="AD"
              alt=""
              className="bg-zinc-800 text-white font-medium ring-1 ring-white/10"
            />
            <SidebarLabel>Adrien</SidebarLabel>
            <ArrowRightStartOnRectangleIcon data-slot="icon" />
          </SidebarItem>
        </SidebarSection>
      </SidebarFooter>
    </Sidebar>
  )
}
