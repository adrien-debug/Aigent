import {
  BeakerIcon,
  Cog6ToothIcon,
  CpuChipIcon,
  PlayCircleIcon,
  RectangleStackIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline'
import type { ComponentType, SVGProps } from 'react'

export interface V2NavItem {
  label: string
  href: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  /** `false` when the destination is still the legacy V1 screen. Rendered as a
   *  visible "V1" tag: the entry is real and reachable, and the reader is told
   *  it leaves the V2 slice instead of discovering it after the click. */
  v2: boolean
}

/**
 * AIGENT-FRONTEND-RESET-001 — the six shell entries the mission names. Every
 * href resolves to a route that EXISTS today: Runs is the V2 cockpit, the five
 * others point at their live `/admin/**` screens until their V2 slice lands.
 * No placeholder, no dead link.
 */
export const V2_NAV_ITEMS: V2NavItem[] = [
  { label: 'Dashboard', href: '/admin', icon: Squares2X2Icon, v2: false },
  { label: 'Runs', href: '/admin-v2/runs', icon: PlayCircleIcon, v2: true },
  { label: 'Agents', href: '/admin/agents', icon: CpuChipIcon, v2: false },
  { label: 'Projects', href: '/admin/projects', icon: RectangleStackIcon, v2: false },
  { label: 'Factory', href: '/admin/factory', icon: BeakerIcon, v2: false },
  { label: 'Settings', href: '/admin/settings', icon: Cog6ToothIcon, v2: false },
]

/** Active only on the V2 route itself — a legacy entry never lights up here. */
export function isNavItemCurrent(item: V2NavItem, pathname: string): boolean {
  if (!item.v2) return false
  return pathname === item.href || pathname.startsWith(`${item.href}/`)
}
