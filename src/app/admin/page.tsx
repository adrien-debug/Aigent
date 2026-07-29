import type { Metadata } from 'next'

import { ConsoleShell } from '@/components/console/console-shell'
import { OverviewScreen } from '@/components/console/overview-screen'
import { getDashboardPageData } from '@/lib/agent-mission-control/dashboard-page-data'

export const metadata: Metadata = {
  title: 'Overview — Aigent',
}

export default async function AdminPage() {
  const { overview } = await getDashboardPageData()

  // `src/app/admin/layout.tsx` is a pass-through by design (a server layout has
  // no pathname, so it could never supply `activeHref`). Every admin page mounts
  // the frame itself — this one did not, so `/admin` rendered the screen with no
  // rail and no topbar at all while the five other routes had both.
  const degraded = overview.dataWarnings.length > 0

  return (
    <ConsoleShell
      activeHref="/admin"
      title="Overview"
      degraded={degraded}
      // Exactly what an empty `dataWarnings` proves, and no more: the collector
      // swallows `getRecentRunsInWindow` failures into `[]` without raising a
      // warning, so "all sources reporting" would be an unbacked claim here.
      // Same wording as the platform-state row the screen itself renders.
      stateLabel={degraded ? 'Partial data' : 'No data-source warning reported'}
    >
      <OverviewScreen overview={overview} />
    </ConsoleShell>
  )
}
