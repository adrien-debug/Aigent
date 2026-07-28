'use client'

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { BellIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { useSyncExternalStore } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Input, InputGroup } from '@/components/ui/input'
import { Link } from '@/components/ui/link'
import { surfaceOverlay } from '@/components/ui/panel'
import type { ViewerIdentity } from '@/lib/aigent-v2/runs-page-data'

/**
 * The clock, without a hydration mismatch and without a setState-in-effect.
 *
 * The server renders its own instant (UTC, from the page's `nowIso`); the
 * client hydrates with that exact string via `getServerSnapshot`, then swaps to
 * the reader's local time on the first post-hydration render.
 * `useSyncExternalStore` is the API built for this — an effect calling setState
 * immediately triggers the cascading render the React lint rule flags.
 *
 * `getSnapshot` must be referentially stable between ticks or React re-renders
 * forever, hence the cached label keyed on the 30s bucket.
 */
let cachedLabel = ''
let cachedBucket = -1

function localLabel(): string {
  const now = Date.now()
  const bucket = Math.floor(now / 30_000)
  if (bucket !== cachedBucket) {
    cachedBucket = bucket
    cachedLabel = new Date(now).toLocaleString('en-US', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return cachedLabel
}

function subscribeToClock(onChange: () => void): () => void {
  const id = setInterval(onChange, 30_000)
  return () => clearInterval(id)
}

function useLocalTimestamp(nowIso: string): string {
  const serverLabel = `${nowIso.slice(11, 16)} UTC`
  return useSyncExternalStore(subscribeToClock, localLabel, () => serverLabel)
}

export function V2Topbar({
  nowIso,
  viewer,
  search,
  onSearchChange,
}: {
  nowIso: string
  viewer: ViewerIdentity
  search: string
  onSearchChange: (value: string) => void
}) {
  const timestamp = useLocalTimestamp(nowIso)

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <InputGroup>
          <MagnifyingGlassIcon data-slot="icon" />
          <Input
            type="search"
            aria-label="Search runs"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search run id, agent, project or input…"
          />
        </InputGroup>
      </div>

      <div className="hidden shrink-0 text-sm text-zinc-400 sm:block">
        <time dateTime={nowIso}>{timestamp}</time>
      </div>

      <Menu as="div" className="relative shrink-0">
        <MenuButton
          aria-label="Notifications"
          className="flex size-10 items-center justify-center rounded-lg text-zinc-400 hover:text-white data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
        >
          {/* No badge: Aigent has no notification feed wired, and a count here
              would be a number nothing produced. */}
          <BellIcon className="size-5" />
        </MenuButton>
        <MenuItems anchor={{ to: 'bottom end', gap: 8 }} className={`z-50 w-72 p-4 ${surfaceOverlay}`}>
          <p className="text-sm font-medium text-white">Notifications</p>
          <p className="mt-1 text-xs/5 text-zinc-400">
            No notification source is wired to Aigent yet, so this panel stays empty rather than
            showing a placeholder count. Run failures are visible in the feed below.
          </p>
        </MenuItems>
      </Menu>

      <Menu as="div" className="relative shrink-0">
        <MenuButton
          className="flex items-center gap-2 rounded-lg p-1 data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
          aria-label="Account menu"
        >
          {/* The admin session carries no name — the role initial is what can be
              proven, so no invented person is displayed. */}
          <Avatar
            initials={(viewer.role ?? '?').slice(0, 1).toUpperCase()}
            alt=""
            className="size-8 bg-zinc-800 text-[11px] font-medium text-white ring-1 ring-white/10"
          />
          <span className="hidden pr-1 text-xs text-zinc-400 sm:block">
            {viewer.authenticated ? (viewer.role ?? 'session') : 'no session'}
          </span>
        </MenuButton>
        <MenuItems anchor={{ to: 'bottom end', gap: 8 }} className={`z-50 w-56 p-1.5 ${surfaceOverlay}`}>
          <p className="px-3 py-2 text-xs text-zinc-400">
            {viewer.authenticated
              ? `Signed in · role ${viewer.role ?? 'unknown'}`
              : 'No admin session detected'}
          </p>
          <MenuItem>
            <Link
              href="/admin"
              className="block rounded-lg px-3 py-2 text-sm text-zinc-300 data-focus:bg-white/5 data-focus:text-white"
            >
              Back to V1 dashboard
            </Link>
          </MenuItem>
          <MenuItem>
            <Link
              href="/logout"
              className="block rounded-lg px-3 py-2 text-sm text-zinc-300 data-focus:bg-white/5 data-focus:text-white"
            >
              Log out
            </Link>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  )
}
