'use client'

import { ArrowRightStartOnRectangleIcon, Cog6ToothIcon, CpuChipIcon, FolderIcon, Squares2X2Icon } from '@heroicons/react/20/solid'
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
        'group relative flex aspect-square w-full flex-col items-center justify-center gap-1 rounded-xl px-1 text-center transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500',
        current
          ? // active nav — copper selected surface + left heat bar + warm ring
            'bg-[var(--copper-surface)] text-accent-700 ring-1 ring-[var(--copper-line)] dark:text-accent-300 before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-accent-500'
          : 'text-zinc-500 hover:bg-[var(--copper-soft)] hover:text-accent-600 dark:hover:text-accent-300'
      )}
    >
      <Icon aria-hidden="true" className="size-5 shrink-0" />
      {/* Label réduit + contraint à la largeur du bouton (ne dépasse plus).
          text-xs = plus petite taille de l'échelle typo du repo (pas de
          text-[10px] hors échelle) ; leading-tight compense pour rester compact. */}
      <span className="w-full truncate text-center text-xs font-medium leading-tight">{label}</span>
    </Link>
  )
}

export function AgentControlShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="relative isolate flex min-h-svh w-full flex-col bg-zinc-100 dark:bg-zinc-900">
      {/* Narrow rail — fixed, desktop. Icon-over-label square buttons. */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-20 flex-col items-center border-r border-zinc-950/5 bg-white py-4 lg:flex dark:border-white/10 dark:bg-zinc-950">
        {/* Brand mark */}
        <Link
          href="/admin"
          aria-label="Agent Mission Control"
          className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--copper-surface)] ring-1 ring-[var(--copper-line)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          <LogoMark className="size-5 text-accent-500 dark:text-accent-400" />
        </Link>

        {/* Nav — square icon+label buttons, centrés sur l'axe vertical du rail
            (directive Adrien) : flex-1 prend toute la hauteur entre le logo et
            l'avatar, justify-center groupe les boutons au centre. */}
        <nav className="mt-6 flex w-full flex-1 flex-col justify-center gap-2 px-2">
          {NAV_ITEMS.map(({ label, icon, href, match }) => (
            <RailItem key={label} label={label} icon={icon} href={href} current={match(pathname)} />
          ))}
        </nav>

        {/* User avatar + discreet sign-out, pinned to the bottom */}
        <div className="mt-auto flex flex-col items-center gap-3 pt-4">
          <Avatar initials="AD" alt="Adrien — Platform Admin" className="size-9 bg-zinc-800 text-white" />
          <a
            href="/logout"
            aria-label="Sign out"
            title="Sign out"
            className="flex size-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-[var(--copper-soft)] hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:hover:text-accent-300"
          >
            <ArrowRightStartOnRectangleIcon aria-hidden="true" className="size-5" />
          </a>
        </div>
      </aside>

      {/* Mobile top bar — brand + inline nav (rail collapses on small screens) */}
      <header className="flex items-center gap-2 border-b border-zinc-950/5 bg-white px-4 py-2 lg:hidden dark:border-white/10 dark:bg-zinc-950">
        <Link href="/admin" aria-label="Agent Mission Control" className="flex size-8 items-center justify-center rounded-lg bg-zinc-950/5 dark:bg-white/5">
          <LogoMark className="size-4 text-accent-500 dark:text-accent-400" />
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
                  ? 'bg-[var(--copper-surface)] text-accent-700 ring-1 ring-[var(--copper-line)] dark:text-accent-300'
                  : 'text-zinc-500 hover:bg-[var(--copper-soft)] hover:text-accent-600 dark:hover:text-accent-300'
              )}
            >
              <Icon aria-hidden="true" className="size-4" />
              {label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Content — offset by the rail width on desktop. */}
      <main className="flex min-w-0 flex-1 flex-col lg:pl-20">
        <div className="grow bg-zinc-100 p-4 lg:p-6 dark:bg-zinc-900">{children}</div>
      </main>
    </div>
  )
}
