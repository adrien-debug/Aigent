'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { Badge } from '@/components/ui/badge'

const REFRESH_INTERVAL_MS = 30_000
const PREFLIGHT_TIMEOUT_MS = 2_500
const BACKOFF_MAX_MS = 120_000

function clockFromIso(iso: string): string {
  return `${iso.slice(11, 19)} UTC`
}

/**
 * Cheap same-origin probe before `router.refresh()`. Next's RSC flight fetch
 * throws an uncaught "Failed to fetch" when the dev server is hung/restarting;
 * HEAD `/` (never the current heavy admin route) lets us skip + back off.
 */
async function serverReachable(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS)
  try {
    const res = await fetch('/', {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    })
    // Next may reject HEAD with 405 — that still proves the process answers.
    return res.ok || res.status === 405 || res.status === 501
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

/**
 * LiveRefresh — re-fetches server data every 30s via `router.refresh()` when
 * the origin answers. Skips + backs off when the server is unreachable so a
 * hung Turbopack process does not spam Next's `fetchServerResponse` errors.
 *
 * Polling pauses while `document.hidden`.
 */
export function LiveRefresh({ initialRefreshedAt }: { initialRefreshedAt: string }) {
  const router = useRouter()
  const [lastRefreshedAt, setLastRefreshedAt] = useState(() => clockFromIso(initialRefreshedAt))
  const [online, setOnline] = useState(true)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let delay = REFRESH_INTERVAL_MS

    const schedule = (ms: number) => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(tick, ms)
    }

    const tick = async () => {
      if (cancelled || document.hidden) return

      const ok = await serverReachable()
      if (cancelled) return

      if (!ok) {
        setOnline(false)
        delay = Math.min(delay * 2, BACKOFF_MAX_MS)
        schedule(delay)
        return
      }

      setOnline(true)
      delay = REFRESH_INTERVAL_MS
      router.refresh()
      setLastRefreshedAt(clockFromIso(new Date().toISOString()))
      schedule(delay)
    }

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (timer !== null) {
          clearTimeout(timer)
          timer = null
        }
        return
      }
      delay = REFRESH_INTERVAL_MS
      void tick()
    }

    if (!document.hidden) schedule(REFRESH_INTERVAL_MS)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibilityChange)
      if (timer !== null) clearTimeout(timer)
    }
  }, [router])

  return (
    <div className="flex items-center gap-3">
      <Badge color={online ? 'accent' : 'zinc'} className="uppercase tracking-widest">
        {online ? (
          <span aria-hidden="true" className="size-1.5 rounded-full bg-accent-400 motion-safe:animate-pulse" />
        ) : null}
        {online ? 'Live' : 'Paused'}
      </Badge>
      {/* A <span>, not <Text>. `Text` renders a <p> whose own `text-base/6
          sm:text-sm/6` BEATS a caller's `text-xs` — the primitive composes
          `clsx(className, defaults)` and Tailwind settles a same-property clash
          by the order of the compiled sheet, not by the class attribute
          (DESIGN-DOCTRINE §Cascade). So this clock rendered at 14px while the
          code claimed 12px, and `Text` has no size prop to make the intent real.
          A paragraph was the wrong box anyway: this is an inline readout beside
          a badge in a page-header row, and it now matches the `<span>` meta
          pattern used by every other header in the dashboard. zinc-400 rather
          than `Text`'s zinc-500 for the same reason as everywhere else — 12px
          zinc-500 measures 3.59:1 here, under the 4.5 AA floor. */}
      <span className="font-mono text-xs text-zinc-400 tabular-nums">{lastRefreshedAt}</span>
      <span className="sr-only">
        {online
          ? 'Page data auto-refreshes every 30 seconds while this tab is visible.'
          : 'Auto-refresh paused — server unreachable; will retry with backoff.'}
      </span>
    </div>
  )
}
