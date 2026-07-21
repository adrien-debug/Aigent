'use client'

import { ArrowRightStartOnRectangleIcon, Bars3Icon, ChartBarIcon, Cog6ToothIcon, CpuChipIcon, MagnifyingGlassIcon, SignalIcon, Squares2X2Icon, XMarkIcon } from '@heroicons/react/20/solid'
import * as Headless from '@headlessui/react'
import { AnimatePresence, motion } from 'motion/react'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Avatar } from '@/components/catalyst/avatar'
import { CommandPalette } from '@/components/agent-ops/command-palette'
import { surfaceNavClass } from '@/components/agent-ops/surface-card'

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

const NAV_ITEMS = [
  // Projects & copilots live on the dashboard (project boxes → project page →
  // its agents) — no dedicated list tabs.
  { label: 'Dashboard', icon: Squares2X2Icon, href: '/admin', match: (p: string) => p === '/admin' || p.startsWith('/admin/projects') || p.startsWith('/admin/agents') },
  { label: 'Performance', icon: ChartBarIcon, href: '/admin/performance', match: (p: string) => p.startsWith('/admin/performance') },
  { label: 'Telemetry', icon: SignalIcon, href: '/admin/telemetry', match: (p: string) => p.startsWith('/admin/telemetry') },
  { label: 'Settings', icon: Cog6ToothIcon, href: '/admin/settings', match: (p: string) => p.startsWith('/admin/settings') },
] as const

function RailItem({
  label,
  icon: Icon,
  href,
  current,
}: {
  label: string
  icon: typeof CpuChipIcon
  href: string
  current: boolean
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      className={clsx(
        'group relative flex size-11 items-center justify-center rounded-xl border transition-[color,background-color,border-color] duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? 'border-[var(--accent-line-strong)] bg-[var(--accent-surface)] text-zinc-900'
          : 'border-transparent text-zinc-500 hover:border-zinc-950/5 hover:bg-zinc-950/5 hover:text-zinc-900'
      )}
    >
      <Icon aria-hidden="true" className={clsx('size-5 shrink-0 transition-colors duration-200', current ? 'text-accent-700' : 'group-hover:text-zinc-700')} />
      <span className="sr-only">{label}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 ring-1 ring-white/10 group-hover:block group-focus-visible:block"
      >
        {label}
      </span>
    </Link>
  )
}

/** Shared avatar + sign-out control — identical between the desktop rail
    footer and the mobile drawer footer, sized/colored per placement. */
function UserFooter({
  avatarSize,
  iconWrapClassName,
  iconIdleColorClassName,
  children,
}: {
  avatarSize: 'size-8' | 'size-7'
  iconWrapClassName: string
  iconIdleColorClassName: string
  /** Optional content between the avatar and the sign-out button (e.g. the user's name in the mobile drawer). */
  children?: React.ReactNode
}) {
  return (
    <>
      <Avatar
        initials="AD"
        alt="Adrien"
        className={clsx(avatarSize, 'bg-zinc-100 text-zinc-900 font-medium ring-1 ring-zinc-950/10', avatarSize === 'size-8' ? 'text-[11px]' : 'text-[10px]')}
      />
      {children}
      <a
        href="/logout"
        aria-label="Sign out"
        className={clsx(
          'flex items-center justify-center rounded-lg transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
          iconIdleColorClassName,
          iconWrapClassName
        )}
      >
        <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-4" />
      </a>
    </>
  )
}

function MobileNavItem({
  label,
  icon: Icon,
  href,
  current,
  onNavigate,
}: {
  label: string
  icon: typeof CpuChipIcon
  href: string
  current: boolean
  onNavigate: () => void
}) {
  return (
    <Link
      href={href}
      aria-current={current ? 'page' : undefined}
      onClick={onNavigate}
      className={clsx(
        'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? 'bg-zinc-950/5 text-zinc-900'
          : 'text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-900'
      )}
    >
      <Icon aria-hidden="true" className={clsx('size-5 shrink-0', current ? 'text-zinc-900' : 'text-zinc-500')} />
      <span className="text-sm font-medium tracking-wide">{label}</span>
      {current && (
        <span className="ml-auto size-1.5 rounded-full bg-accent-500" aria-hidden="true" />
      )}
    </Link>
  )
}

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [lastPath, setLastPath] = useState(pathname)

  // Close the mobile drawer on route change (derived during render — the
  // official React pattern, no setState-in-effect). Covers back/forward and
  // programmatic navigation in addition to in-drawer clicks.
  if (pathname !== lastPath) {
    setLastPath(pathname)
    if (mobileOpen) setMobileOpen(false)
  }

  // Lock body scroll while the mobile drawer is open.
  useEffect(() => {
    if (!mobileOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [mobileOpen])

  const activeItem = NAV_ITEMS.find((item) => item.match(pathname))

  return (
    <div className="relative isolate flex min-h-svh w-full bg-[var(--color-surface-canvas)] text-zinc-900 font-sans selection:bg-[var(--accent-selection)]">
      <CommandPalette />

      {/* Sidebar - compact icon rail */}
      <aside className={clsx(surfaceNavClass, 'fixed inset-y-3 left-3 z-20 hidden w-16 flex-col items-center py-4 lg:flex')}>

        {/* Brand Header */}
        <Link
          href="/admin"
          aria-label="Agent Mission Control"
          className="flex size-11 shrink-0 items-center justify-center transition-transform hover:scale-105"
        >
          <LogoMark className="size-7 text-zinc-900" />
        </Link>

        <Headless.Button
          aria-label="Search"
          onClick={() => window.dispatchEvent(new Event('aigent:command-palette'))}
          className="group relative mt-2 flex size-11 shrink-0 items-center justify-center rounded-xl text-zinc-500 transition-colors hover:bg-zinc-950/5 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <MagnifyingGlassIcon aria-hidden="true" className="size-5" />
          <span
            role="tooltip"
            className="pointer-events-none absolute left-full ml-3 hidden whitespace-nowrap rounded-md bg-zinc-900 px-2 py-1 text-xs font-medium text-zinc-200 ring-1 ring-white/10 group-hover:block group-focus-visible:block"
          >
            Search
          </span>
        </Headless.Button>

        {/* Navigation — centered on the rail's vertical axis */}
        <nav className="flex w-full flex-1 flex-col items-center justify-center gap-1">
          {NAV_ITEMS.map(({ label, icon, href, match }) => (
            <RailItem key={label} label={label} icon={icon} href={href} current={match(pathname)} />
          ))}
        </nav>

        {/* User Footer */}
        <div className="mt-auto flex w-full flex-col items-center pb-1">
          <UserFooter avatarSize="size-8" iconWrapClassName="mt-2 size-11 shrink-0" iconIdleColorClassName="text-zinc-600" />
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between gap-3 border-b border-zinc-950/5 bg-[var(--color-surface-secondary)] px-4 py-3 lg:hidden">
        <Link href="/admin" aria-label="Agent Mission Control" className="flex min-w-0 items-center gap-2.5">
          <LogoMark className="size-5 shrink-0 text-zinc-900" />
          <span className="truncate text-sm font-semibold text-zinc-900">Aigent</span>
        </Link>

        <div className="flex shrink-0 items-center gap-2">
          {activeItem && (
            <span className="hidden max-w-[9rem] truncate text-xs font-medium text-zinc-500 sm:inline">
              {activeItem.label}
            </span>
          )}
          <Headless.Button
            onClick={() => setMobileOpen((open) => !open)}
            aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            className={clsx(
              'flex size-11 items-center justify-center rounded-lg text-zinc-500 transition-colors',
              'hover:bg-zinc-950/5 hover:text-zinc-900 active:bg-zinc-950/10',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500'
            )}
          >
            {mobileOpen ? (
              <XMarkIcon aria-hidden="true" className="size-5" />
            ) : (
              <Bars3Icon aria-hidden="true" className="size-5" />
            )}
          </Headless.Button>
        </div>
      </header>

      {/* Mobile navigation drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <motion.button
              type="button"
              aria-label="Close navigation menu"
              onClick={() => setMobileOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-zinc-950/60 backdrop-blur-sm focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-500"
            />
            <motion.nav
              id="mobile-nav-drawer"
              aria-label="Primary"
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+3.75rem)] overflow-hidden rounded-2xl ring-1 ring-zinc-950/5 bg-[var(--color-surface-secondary)] p-2 shadow-xl"
            >
              <div className="flex flex-col gap-1">
                {NAV_ITEMS.map(({ label, icon, href, match }) => (
                  <MobileNavItem
                    key={label}
                    label={label}
                    icon={icon}
                    href={href}
                    current={match(pathname)}
                    onNavigate={() => setMobileOpen(false)}
                  />
                ))}
              </div>

              <div className="mt-2 flex items-center gap-3 border-t border-zinc-950/5 px-3 pb-1 pt-3">
                <UserFooter avatarSize="size-7" iconWrapClassName="size-11" iconIdleColorClassName="text-zinc-500">
                  <span className="flex-1 truncate text-sm font-medium text-zinc-900">Adrien</span>
                </UserFooter>
              </div>
            </motion.nav>
          </div>
        )}
      </AnimatePresence>

      {/* Main fills the viewport; AdminRouteViewport owns overflow-y scroll.
          Do not put overflow-y-auto here with a flex-1/min-h-0 child that does
          not scroll — document pages clipped their header/KPIs above the fold. */}
      <main className="relative z-10 flex h-svh min-h-0 min-w-0 flex-1 flex-col overflow-hidden pt-16 lg:pl-24 lg:pt-0">
        {children}
      </main>
    </div>
  )
}
