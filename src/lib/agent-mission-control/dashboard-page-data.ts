import { getDashboardOverview } from './dashboard-overview'
import type { DashboardOverview } from './dashboard-overview'

export interface DashboardPageData {
  overview: DashboardOverview
  nowMs: number
}

export async function getDashboardPageData(): Promise<DashboardPageData> {
  const nowMs = Date.now()
  return { overview: await getDashboardOverview(nowMs), nowMs }
}
