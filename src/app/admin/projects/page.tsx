import type { Metadata } from 'next'

import { ConsoleShell } from '@/components/console/console-shell'
import { ProjectsScreen } from '@/components/console/projects-screen'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { pgrestDetail } from '@/lib/agent-mission-control/postgrest'

export const metadata: Metadata = { title: 'Projects — Aigent' }

/** Both reads are live on every request (`pgrest` sends `no-store`); declared
 *  here so the route stays dynamic on its own, not by inheritance. */
export const dynamic = 'force-dynamic'

/**
 * Same two reads as before — `getProjects()` and `getCopilots({ health: 'list' })`,
 * unchanged — but settled independently, in the two tiers `runs-page-data.ts`
 * already established for `/admin/runs`:
 *
 *  - PROJECTS is load-bearing: if it throws, this page throws. An unreadable
 *    backend is never flattened into an empty, healthy-looking registry.
 *  - COPILOTS carries the agent figures: if it throws, the projects still
 *    render and every agent-derived number reports itself unavailable, so the
 *    screen degrades to fewer facts instead of to fabricated zeros.
 */
export default async function ProjectsPage() {
  const [projectsResult, copilotsResult] = await Promise.allSettled([
    getProjects(),
    getCopilots({ health: 'list' }),
  ])

  if (projectsResult.status === 'rejected') throw projectsResult.reason

  const copilots = copilotsResult.status === 'fulfilled' ? copilotsResult.value : null
  const agentsErrorDetail =
    copilotsResult.status === 'rejected' ? pgrestDetail(copilotsResult.reason) : null

  return (
    <ConsoleShell
      activeHref="/admin/projects"
      title="Projects"
      degraded={copilots === null}
      stateTone={copilots === null ? 'negative' : 'neutral'}
      stateLabel={copilots === null ? 'Agent registry unreadable' : 'No source warning on this screen'}
    >
      <ProjectsScreen
        projects={projectsResult.value}
        copilots={copilots}
        agentsErrorDetail={agentsErrorDetail}
      />
    </ConsoleShell>
  )
}
