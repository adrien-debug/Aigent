'use client'

import {
  ChartBarIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  MagnifyingGlassIcon,
  RectangleStackIcon,
  SignalIcon,
  Squares2X2Icon,
  WrenchScrewdriverIcon,
} from '@heroicons/react/20/solid'
import { ArrowRightStartOnRectangleIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { usePathname } from 'next/navigation'

import { eyebrowClass } from '@/components/shell/page-header'
import { Avatar } from '@/components/ui/avatar'
import {
  Sidebar,
  SidebarBody,
  SidebarFooter,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui/sidebar'

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
      { label: 'Factory', href: '/admin/factory', icon: WrenchScrewdriverIcon, exact: false },
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
        <div className="flex items-center gap-3 px-2 pt-1 pb-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent-500 text-zinc-950 shadow-sm ring-1 ring-[var(--accent-line-strong)]">
            <LogoMark className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight text-zinc-950 dark:text-white">Aigent</div>
            <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">Agent Operations</div>
          </div>
        </div>

        {/* Search reads as a control, not a nav destination: sunken field with a
            ⌘K affordance, so it is told apart from the routes below at a glance. */}
        <SidebarSection>
          <SidebarItem
            onClick={() => window.dispatchEvent(new Event('aigent:command-palette'))}
            className="rounded-lg bg-zinc-950/[0.03] ring-1 ring-zinc-950/5 dark:bg-surface-sunken dark:ring-[var(--surface-border)]"
          >
            <MagnifyingGlassIcon data-slot="icon" />
            <SidebarLabel className="text-zinc-500 dark:text-zinc-400">Search</SidebarLabel>
            <kbd className="ml-auto font-sans text-[10px] font-medium text-zinc-400 dark:text-zinc-400">⌘K</kbd>
          </SidebarItem>
        </SidebarSection>
      </SidebarHeader>

      <SidebarBody className="gap-y-1">
        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.heading}>
            {/* Same eyebrow treatment as every other section label in the app
                (10px, uppercase, wide tracking) so the sidebar headings and the
                panel/KPI overlines read as one typographic family — imported
                from `eyebrowClass` (surface-card.tsx) so the two never drift. */}
            <SidebarHeading className={clsx('mb-1.5 px-2', eyebrowClass)}>
              {section.heading}
            </SidebarHeading>
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
              className="bg-zinc-200 text-zinc-700 font-medium ring-1 ring-zinc-950/10 dark:bg-surface-sunken dark:text-zinc-300 dark:ring-[var(--surface-border-strong)]"
            />
            <SidebarLabel>Adrien</SidebarLabel>
            <ArrowRightStartOnRectangleIcon data-slot="icon" />
          </SidebarItem>
        </SidebarSection>
      </SidebarFooter>
    </Sidebar>
  )
}
