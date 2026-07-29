import {
  BeakerIcon,
  ChartBarIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  PlayCircleIcon,
  RectangleStackIcon,
  SignalIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import type { ComponentType, SVGProps } from 'react'

export interface AdminNavItem {
  label: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** `true` when the entry must match exactly (the dashboard root). */
  exact: boolean
}

/**
 * The admin rail. Every href resolves to a route that EXISTS — a rail entry
 * pointing at a 404 is worse than a missing entry.
 *
 * `Runs` is new in P004: the fleet-wide run console that previously did not
 * exist (runs were reachable only inside one agent, or as a capped feed on the
 * performance page).
 */
export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Squares2X2Icon, exact: true },
  { label: 'Runs', href: '/admin/runs', icon: PlayCircleIcon, exact: false },
  { label: 'Projects', href: '/admin/projects', icon: RectangleStackIcon, exact: false },
  { label: 'Agents', href: '/admin/agents', icon: CpuChipIcon, exact: false },
  { label: 'Factory', href: '/admin/factory', icon: BeakerIcon, exact: false },
  { label: 'Performance', href: '/admin/performance', icon: ChartBarIcon, exact: false },
  { label: 'Telemetry', href: '/admin/telemetry', icon: SignalIcon, exact: false },
  { label: 'Settings', href: '/admin/settings', icon: Cog6ToothIcon, exact: false },
]

export function isAdminNavItemCurrent(item: AdminNavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`)
}
