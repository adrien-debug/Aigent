'use client'

import { usePathname } from 'next/navigation'

import { ADMIN_NAV_ITEMS, isAdminNavItemCurrent } from '@/components/admin-shell/admin-nav'
import {
  Sidebar,
  SidebarBody,
  SidebarHeader,
  SidebarHeading,
  SidebarItem,
  SidebarLabel,
  SidebarSection,
} from '@/components/ui/sidebar'

function AigentMark({ className }: { className?: string }) {
  // Literal geometry — a mark, not a plotted series.
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <rect x="1.5" y="1.5" width="21" height="21" rx="7" className="fill-accent-500" />
      <path
        d="M8 16.5 12 7l4 9.5"
        stroke="var(--color-zinc-950)"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M9.7 13.4h4.6" stroke="var(--color-zinc-950)" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/**
 * The admin rail, rebuilt on the Catalyst sidebar primitives (P004: Catalyst is
 * the only base material). It replaces `components/shell/aigent-sidebar.tsx`.
 *
 * The reference frame contributes the composition — identity at the top, one
 * flat operations group, no decorative footer — and the surfaces come from the
 * theme tokens retargeted on the frame's measured values.
 */
export function AdminRail() {
  const pathname = usePathname()

  return (
    <Sidebar aria-label="Main">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <AigentMark className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight text-white">Aigent</span>
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading>Operations</SidebarHeading>
          {ADMIN_NAV_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <SidebarItem
                key={item.href}
                href={item.href}
                current={isAdminNavItemCurrent(item, pathname)}
              >
                <Icon data-slot="icon" />
                <SidebarLabel>{item.label}</SidebarLabel>
              </SidebarItem>
            )
          })}
        </SidebarSection>
      </SidebarBody>
    </Sidebar>
  )
}
