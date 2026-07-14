'use client'

import { ArrowRightStartOnRectangleIcon, Cog6ToothIcon, CpuChipIcon, FolderIcon, ShareIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { Avatar } from '@/components/catalyst/avatar'

/**
 * Hearst "H" monogram — the exact two-polygon brand mark lifted from the
 * hearst-connect logo. Draws in `currentColor` so consumers pick the hue
 * (accent orange on the rail). Single source: change here, every mount
 * updates. viewBox is cropped to the H's bounding box in the source artwork.
 */
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
 * Narrow navigation rail (directive Adrien 2026-07-11) : icône en haut, nom du
 * menu dessous, chaque item = un bouton carré. Rail fixe ~5rem de large, items
 * empilés verticalement. Remplace la SidebarLayout large de Catalyst.
 */
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
        'group relative flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-center transition-all duration-300',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? 'bg-zinc-950/5 text-zinc-900 dark:bg-white/10 dark:text-white'
          : 'text-zinc-500 hover:bg-zinc-950/5 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-white'
      )}
    >
      {current && (
        <span className="absolute left-0 top-1/2 h-8 w-1 -translate-y-1/2 rounded-r-full bg-(--accent-line-strong)" />
      )}
      <Icon aria-hidden="true" className={clsx("size-5 shrink-0 transition-transform duration-300", current ? "scale-110 text-(--accent-line-strong)" : "group-hover:scale-110")} />
      <span className="w-full text-[9px] font-semibold uppercase tracking-wider opacity-80">{label}</span>
    </Link>
  )
}

import { CommandPalette } from '@/components/agent-ops/command-palette'

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="relative isolate flex min-h-svh w-full flex-col bg-zinc-100 dark:bg-zinc-900">
      <CommandPalette />
      {/* Matte Grain Overlay — adds physical texture to the background */}
      <div 
        className="pointer-events-none fixed inset-0 z-50 opacity-[0.03] mix-blend-overlay"
        style={{ backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noiseFilter\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noiseFilter)\'/%3E%3C/svg%3E")' }}
      />
      {/* Narrow rail — fixed, desktop. Icon-over-label square buttons. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-24 flex-col items-center border-r border-zinc-950/5 bg-white py-6 lg:flex dark:border-white/10 dark:bg-zinc-950">
        {/* Brand mark */}
        <Link
          href="/admin"
          aria-label="Agent Mission Control"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <LogoMark className="size-6 text-accent-500 dark:text-accent-400" />
        </Link>

        {/* Nav — square icon+label buttons, centrés sur l'axe vertical du rail
            (directive Adrien) : flex-1 prend toute la hauteur entre le logo et
            l'avatar, justify-center groupe les boutons au centre. */}
        <nav className="mt-8 flex w-full flex-1 flex-col justify-center gap-3 px-2">
          {NAV_ITEMS.map(({ label, icon, href, match }) => (
            <RailItem key={label} label={label} icon={icon} href={href} current={match(pathname)} />
          ))}
        </nav>

        {/* User avatar + discreet sign-out, pinned to the bottom */}
        <div className="mt-auto flex flex-col items-center gap-4 pt-6">
          <Avatar initials="AD" alt="Adrien — Platform Admin" className="size-9 bg-zinc-100 text-zinc-900 ring-1 ring-zinc-900/5 dark:bg-zinc-800 dark:text-white dark:ring-white/10" />
          <a
            href="/logout"
            aria-label="Sign out"
            title="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-zinc-500 dark:hover:text-zinc-100"
          >
            <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-5" />
          </a>
        </div>
      </aside>

      {/* Mobile top bar — brand + inline nav (rail collapses on small screens) */}
      <header className="flex items-center gap-3 border-b border-zinc-950/5 bg-white px-4 py-3 lg:hidden dark:border-white/10 dark:bg-zinc-950">
        <Link href="/admin" aria-label="Agent Mission Control" className="flex size-8 items-center justify-center rounded-lg">
          <LogoMark className="size-5 text-accent-500 dark:text-accent-400" />
        </Link>
        <nav className="no-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto">
          {NAV_ITEMS.map(({ label, icon: Icon, href, match }) => (
            <Link
              key={label}
              href={href}
              aria-current={match(pathname) ? 'page' : undefined}
              className={clsx(
                'flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                match(pathname)
                  ? 'bg-(--accent-surface) text-accent-700 ring-1 ring-inset ring-(--accent-line) dark:text-accent-300'
                  : 'text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Content — offset by the rail width on desktop. */}
      <main className="flex min-w-0 flex-1 flex-col lg:pl-24">
        <div className="grow bg-zinc-50 p-4 lg:p-8 dark:bg-zinc-950 dark:bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(255,255,255,0.03),rgba(255,255,255,0))]">{children}</div>
      </main>
    </div>
  )
}
