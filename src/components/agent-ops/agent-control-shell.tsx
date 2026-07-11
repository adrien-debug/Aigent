'use client'

import { Cog6ToothIcon, CpuChipIcon, FolderIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Avatar } from '@/components/catalyst/avatar'

/** Mission-control reticle mark — inline SVG, no external asset. */
function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={clsx('text-zinc-950 dark:text-white', className)}>
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

/**
 * Narrow navigation rail (directive Adrien 2026-07-11) : icône en haut, nom du
 * menu dessous, chaque item = un bouton carré. Rail fixe ~5rem de large, items
 * empilés verticalement. Remplace la SidebarLayout large de Catalyst.
 */
const NAV_ITEMS = [
  { label: 'Dashboard', icon: Squares2X2Icon, href: '/admin', match: (p: string) => p === '/admin' },
  { label: 'Copilots', icon: CpuChipIcon, href: '/admin/agents', match: (p: string) => p === '/admin/agents' || p.startsWith('/admin/agents/') },
  { label: 'Projects', icon: FolderIcon, href: '/admin/projects', match: (p: string) => p.startsWith('/admin/projects') },
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
        'group flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? 'bg-accent-500/10 text-accent-700 ring-1 ring-accent-500/20 dark:text-accent-300'
          : 'text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-950 dark:hover:bg-white/5 dark:hover:text-white'
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      <span className="text-xs font-medium leading-tight">{label}</span>
    </Link>
  )
}

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="relative isolate flex min-h-svh w-full bg-zinc-100 dark:bg-zinc-900">
      {/* Narrow rail — fixed, desktop. Icon-over-label square buttons. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center border-r border-zinc-950/5 bg-white py-4 lg:flex dark:border-white/10 dark:bg-zinc-950">
        {/* Brand mark */}
        <Link
          href="/admin"
          aria-label="Agent Mission Control"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-zinc-950/5 ring-1 ring-zinc-950/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:bg-white/5 dark:ring-white/10"
        >
          <LogoMark className="size-5" />
        </Link>

        {/* Nav — square icon+label buttons */}
        <nav className="mt-6 flex w-full flex-1 flex-col gap-2 px-2">
          {NAV_ITEMS.map(({ label, icon, href, match }) => (
            <RailItem key={label} label={label} icon={icon} href={href} current={match(pathname)} />
          ))}
        </nav>

        {/* User avatar pinned to the bottom */}
        <div className="mt-auto pt-4">
          <Avatar initials="AD" alt="Adrien — Platform Admin" className="size-9 bg-zinc-800 text-white" />
        </div>
      </aside>

      {/* Mobile top bar — brand + inline nav (rail collapses on small screens) */}
      <header className="flex items-center gap-2 border-b border-zinc-950/5 bg-white px-4 py-2 lg:hidden dark:border-white/10 dark:bg-zinc-950">
        <Link href="/admin" aria-label="Agent Mission Control" className="flex size-8 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/5">
          <LogoMark className="size-4" />
        </Link>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ label, icon: Icon, href, match }) => (
            <Link
              key={label}
              href={href}
              aria-current={match(pathname) ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium',
                match(pathname)
                  ? 'bg-accent-500/10 text-accent-700 dark:text-accent-300'
                  : 'text-zinc-500 hover:bg-zinc-950/5 dark:hover:bg-white/5'
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Content — offset by the rail width on desktop. */}
      <main className="flex flex-1 flex-col lg:min-w-0 lg:pl-20">
        <div className="grow bg-zinc-100 p-4 lg:p-6 dark:bg-zinc-900">{children}</div>
      </main>
    </div>
  )
}
