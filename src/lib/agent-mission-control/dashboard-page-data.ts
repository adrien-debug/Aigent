import { getDashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'

export interface DashboardPageData {
  overview: DashboardOverview
  nowMs: number
}

/**
 * `/admin` data-fetch, extracted so `page.tsx` stays a pure `data + <View />`
 * shell (see `scripts/check-views.mjs`). The clock read is captured ONCE here
 * — outside the React component body, so it stays a plain impure function call
 * rather than an impure call during render — and passed into
 * `getDashboardOverview` so the KPI window, the hourly chart buckets and the
 * shared `windowRuns` all agree on one instant instead of drifting across two
 * separate loads. The page is `force-dynamic`, so a fresh instant per request
 * is the intended behaviour.
 */
export async function getDashboardPageData(): Promise<DashboardPageData> {
  const nowMs = Date.now()
  const overview = await getDashboardOverview(nowMs)
  return { overview, nowMs }
}
