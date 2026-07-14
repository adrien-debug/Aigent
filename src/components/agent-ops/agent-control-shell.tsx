'use client'

import { ArrowRightStartOnRectangleIcon, Cog6ToothIcon, CpuChipIcon, FolderIcon, ShareIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Avatar } from '@/components/catalyst/avatar'
import { CommandPalette } from '@/components/agent-ops/command-palette'

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
  { label: 'Dashboard', icon: Squares2X2Icon, href: '/admin', match: (p: string) => p === '/admin' },
  { label: 'Copilots', icon: CpuChipIcon, href: '/admin/agents', match: (p: string) => p === '/admin/agents' || p.startsWith('/admin/agents/') },
  { label: 'Projects', icon: FolderIcon, href: '/admin/projects', match: (p: string) => p.startsWith('/admin/projects') },
  { label: 'LangGraph', icon: ShareIcon, href: '/admin/langgraph', match: (p: string) => p.startsWith('/admin/langgraph') },
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
        'group relative flex w-full items-center gap-3 rounded-md px-3 py-2 transition-all duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? 'text-white bg-white/5'
          : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.02]'
      )}
    >
      <Icon aria-hidden="true" className={clsx("size-4 shrink-0 transition-colors duration-200", current ? "text-white" : "group-hover:text-zinc-400")} />
      <span className="text-[13px] font-medium tracking-wide">{label}</span>
      {current && (
        <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-white" />
      )}
    </Link>
  )
}

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="relative isolate flex min-h-svh w-full bg-[var(--color-surface-canvas)] text-zinc-100 font-sans selection:bg-accent-500/30">
      <CommandPalette />
      
      {/* Sidebar - Ultra refined, no heavy backgrounds, just a subtle border */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-[220px] flex-col border-r border-white/5 bg-[var(--color-surface-canvas)] py-6 lg:flex">
        
        {/* Brand Header */}
        <div className="flex items-center gap-3 px-6 mb-8">
          <Link
            href="/admin"
            aria-label="Agent Mission Control"
            className="flex size-6 shrink-0 items-center justify-center transition-transform hover:scale-105"
          >
            <LogoMark className="size-5 text-white" />
          </Link>
          <span className="text-[13px] font-semibold tracking-tight text-white">Aigent</span>
        </div>

        {/* Navigation */}
        <nav className="flex w-full flex-1 flex-col gap-0.5 px-3">
          {NAV_ITEMS.map(({ label, icon, href, match }) => (
            <RailItem key={label} label={label} icon={icon} href={href} current={match(pathname)} />
          ))}
        </nav>

        {/* User Footer */}
        <div className="mt-auto px-4 pb-2">
          <div className="flex items-center gap-3 px-2 py-2 rounded-md hover:bg-white/5 transition-colors cursor-pointer group">
            <Avatar initials="AD" alt="Adrien" className="size-6 bg-zinc-800 text-white text-[10px] font-medium ring-1 ring-white/10" />
            <span className="text-[13px] font-medium text-zinc-400 group-hover:text-white transition-colors truncate flex-1">Adrien</span>
            <a
              href="/logout"
              aria-label="Sign out"
              className="flex size-6 shrink-0 items-center justify-center text-zinc-600 transition-colors hover:text-white opacity-0 group-hover:opacity-100"
            >
              <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-3.5" />
            </a>
          </div>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="fixed top-0 left-0 right-0 z-30 flex items-center justify-between border-b border-white/5 bg-[var(--color-surface-canvas)]/80 backdrop-blur-md px-4 py-3 lg:hidden">
        <div className="flex items-center gap-3">
          <Link href="/admin" aria-label="Agent Mission Control" className="flex size-6 items-center justify-center">
            <LogoMark className="size-5 text-white" />
          </Link>
          <span className="text-sm font-semibold text-white">Aigent</span>
        </div>
        <nav className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
          {NAV_ITEMS.map(({ label, icon: Icon, href, match }) => (
            <Link
              key={label}
              href={href}
              aria-current={match(pathname) ? 'page' : undefined}
              className={clsx(
                'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors',
                match(pathname)
                  ? 'bg-white/10 text-white'
                  : 'text-zinc-500 hover:text-zinc-300'
              )}
            >
              <Icon aria-hidden="true" className="size-3.5" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Main Content Area */}
      <main className="flex min-w-0 flex-1 flex-col pt-16 lg:pl-[220px] lg:pt-0 relative z-10">
        <div className="grow p-6 lg:p-10 max-w-[1400px] w-full">
          {children}
        </div>
      </main>
    </div>
  )
}
