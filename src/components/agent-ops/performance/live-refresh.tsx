'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

const REFRESH_INTERVAL_MS = 30_000

function clockFromIso(iso: string): string {
  return `${iso.slice(11, 19)} UTC`
}

/**
 * LiveRefresh — silently re-fetches the page's server data every 30s via
 * `router.refresh()` and shows a discreet live indicator: pulsing accent dot
 * (static under prefers-reduced-motion via `motion-safe:`), "Live" label and
 * the last-refresh clock. The initial timestamp is the server render instant
 * (passed as a prop) so SSR and hydration render the exact same string and no
 * state is set synchronously inside the effect; the interval callback then
 * advances it on every refresh.
 */
export function LiveRefresh({ initialRefreshedAt }: { initialRefreshedAt: string }) {
  const router = useRouter()
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => clockFromIso(initialRefreshedAt))

  useEffect(() => {
    const id = setInterval(() => {
      router.refresh()
      setLastRefreshedAt(clockFromIso(new Date().toISOString()))
    }, REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [router])

  return (
    <div className="flex items-center gap-3">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-400 motion-safe:animate-pulse" />
        <span className="text-[10px] font-medium uppercase tracking-widest text-accent-400">Live</span>
      </span>
      <span className="font-mono text-xs text-zinc-500 tabular-nums">{lastRefreshedAt}</span>
      <span className="sr-only">Page data auto-refreshes every 30 seconds.</span>
    </div>
  )
}
