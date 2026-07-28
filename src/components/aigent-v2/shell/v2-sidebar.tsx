'use client'

import { usePathname } from 'next/navigation'

import { V2_NAV_ITEMS, isNavItemCurrent } from '@/components/aigent-v2/shell/v2-nav'
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
import { Text } from '@/components/ui/text'

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
 * V2 rail, built on the Catalyst sidebar primitives (P003: no parallel design
 * system). The Vision reference contributes the COMPOSITION — identity at the
 * top, one operations group, a footnote at the bottom — while the surfaces,
 * spacing and active-state treatment stay the ones `SidebarItem` already
 * defines, so V2 cannot drift from the kit.
 */
export function V2Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()

  return (
    <Sidebar aria-label="Aigent V2">
      <SidebarHeader>
        <div className="flex items-center gap-2.5 px-2 py-1">
          <AigentMark className="size-7" />
          <span className="text-[15px] font-semibold tracking-tight text-zinc-950 dark:text-white">
            Aigent
          </span>
        </div>
      </SidebarHeader>

      <SidebarBody>
        <SidebarSection>
          <SidebarHeading>Operations</SidebarHeading>
          {V2_NAV_ITEMS.map((item) => {
            const current = isNavItemCurrent(item, pathname)
            const Icon = item.icon
            return (
              <SidebarItem
                key={item.href}
                href={item.href}
                current={current}
                onClick={onNavigate}
                title={item.v2 ? undefined : 'Still the V1 screen — opens the legacy dashboard'}
              >
                <Icon data-slot="icon" />
                <SidebarLabel>{item.label}</SidebarLabel>
                {!item.v2 ? (
                  <span className="ml-auto text-[11px] font-medium text-zinc-500">V1</span>
                ) : null}
              </SidebarItem>
            )
          })}
        </SidebarSection>
      </SidebarBody>

      <SidebarFooter>
        <Text size="2xs" className="px-2">
          V1 entries open the legacy dashboard.
        </Text>
      </SidebarFooter>
    </Sidebar>
  )
}
