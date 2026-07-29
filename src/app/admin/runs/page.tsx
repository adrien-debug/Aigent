import type { Metadata } from 'next'

import { ConsoleShell } from '@/components/console/console-shell'
import { RunsScreen } from '@/components/console/runs-screen'
import { getRunsPageData } from '@/lib/runs-console/runs-page-data'

export const metadata: Metadata = {
  title: 'Runs — Aigent',
}

/** The run stream is read live on every request (`pgrest` sends `no-store`);
 *  declared here so the route stays dynamic on its own, not by inheritance. */
export const dynamic = 'force-dynamic'

export default async function RunsPage() {
  const data = await getRunsPageData()

  // The ONLY platform claim this route can back: `getRunsPageData` attempts
  // three reads (runs, agents, projects) and records every failure in
  // `degraded`, so an empty `degraded` means all three answered. Nothing wider
  // is asserted here.
  const degraded = data.degraded.length > 0

  return (
    <ConsoleShell
      activeHref="/admin/runs"
      title="Runs"
      degraded={degraded}
      stateLabel={degraded ? 'Partial labels' : 'All sources reporting'}
    >
      <RunsScreen data={data} />
    </ConsoleShell>
  )
}
