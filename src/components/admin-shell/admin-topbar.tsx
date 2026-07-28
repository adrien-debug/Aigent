'use client'

import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { BellIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'

import { Avatar } from '@/components/ui/avatar'
import { Input, InputGroup } from '@/components/ui/input'
import { Link } from '@/components/ui/link'

const RUNS_ROUTE = '/admin/runs'
const SEARCH_DEBOUNCE_MS = 250

/**
 * The clock, without a hydration mismatch and without a setState-in-effect.
 * The server renders a UTC instant; the client hydrates with that exact string
 * via `getServerSnapshot`, then swaps to local time on the first
 * post-hydration render. `getSnapshot` must be referentially stable between
 * ticks or React re-renders forever, hence the 30s bucket cache.
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

/**
 * The shell topbar: search, current time, notifications, account.
 *
 * SEARCH IS GLOBAL AND LIVES IN THE URL. It is the ONLY search field in the
 * admin surface — the runs console reads `?q=` from `searchParams` rather than
 * owning a second input, so the two can never disagree and a filtered view is
 * always shareable. From any other admin page, typing here navigates to the run
 * console, which is the only surface that can answer a free-text query today.
 */
export function AdminTopbar({
  nowIso,
  viewerRole,
  authenticated,
}: {
  nowIso: string
  viewerRole: string | null
  authenticated: boolean
}) {
  const timestamp = useLocalTimestamp(nowIso)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlQuery = searchParams.get('q') ?? ''

  const [draft, setDraft] = useState(urlQuery)
  // Adopt the URL when it changes under us (navigation, back button).
  const [lastUrlQuery, setLastUrlQuery] = useState(urlQuery)
  if (urlQuery !== lastUrlQuery) {
    setLastUrlQuery(urlQuery)
    setDraft(urlQuery)
  }

  useEffect(() => {
    if (draft === urlQuery) return
    const timer = setTimeout(() => {
      const params = new URLSearchParams(pathname === RUNS_ROUTE ? searchParams.toString() : '')
      if (draft.trim()) params.set('q', draft.trim())
      else params.delete('q')
      const qs = params.toString()
      router.replace(qs ? `${RUNS_ROUTE}?${qs}` : RUNS_ROUTE, { scroll: false })
    }, SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [draft, urlQuery, pathname, searchParams, router])

  return (
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <InputGroup>
          <MagnifyingGlassIcon data-slot="icon" />
          <Input
            type="search"
            aria-label="Search runs"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
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
          className="flex size-10 items-center justify-center rounded-2xl text-zinc-400 hover:text-white data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
        >
          {/* No badge: Aigent has no notification feed, and a count here would
              be a number nothing produced. */}
          <BellIcon className="size-5" />
        </MenuButton>
        <MenuItems
          anchor={{ to: 'bottom end', gap: 8 }}
          className="z-50 w-72 rounded-2xl bg-surface-overlay p-4 ring-1 ring-[var(--surface-border-strong)]"
        >
          <p className="text-sm font-medium text-white">Notifications</p>
          <p className="mt-1 text-xs/5 text-zinc-400">
            No notification source is wired to Aigent yet, so this panel stays empty rather than
            showing a placeholder count. Run failures are visible in the run console.
          </p>
        </MenuItems>
      </Menu>

      <Menu as="div" className="relative shrink-0">
        <MenuButton
          aria-label="Account menu"
          className="flex items-center gap-2 rounded-2xl p-1 data-focus:outline-2 data-focus:outline-offset-2 data-focus:outline-accent-500"
        >
          {/* The admin session carries no name (see auth.ts `AdminSession`), so
              the role initial is what can be proven — no invented person. */}
          <Avatar
            initials={(viewerRole ?? '?').slice(0, 1).toUpperCase()}
            alt=""
            className="size-8 bg-zinc-800 text-[11px] font-medium text-white ring-1 ring-white/10"
          />
          <span className="hidden pr-1 text-xs text-zinc-400 sm:block">
            {authenticated ? (viewerRole ?? 'session') : 'no session'}
          </span>
        </MenuButton>
        <MenuItems
          anchor={{ to: 'bottom end', gap: 8 }}
          className="z-50 w-56 rounded-2xl bg-surface-overlay p-1.5 ring-1 ring-[var(--surface-border-strong)]"
        >
          <p className="px-3 py-2 text-xs text-zinc-400">
            {authenticated ? `Signed in · role ${viewerRole ?? 'unknown'}` : 'No admin session detected'}
          </p>
          <MenuItem>
            <Link
              href="/logout"
              className="block rounded-xl px-3 py-2 text-sm text-zinc-300 data-focus:bg-white/5 data-focus:text-white"
            >
              Log out
            </Link>
          </MenuItem>
        </MenuItems>
      </Menu>
    </div>
  )
}
