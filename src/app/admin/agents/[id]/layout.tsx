import { notFound } from 'next/navigation'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { CopilotTabs } from '@/components/agent-ops/copilot-tabs'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Button } from '@/components/catalyst/button'
import { getCopilot, getProject } from '@/lib/agent-mission-control/mock-data'

export default async function CopilotLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const copilot = getCopilot(id)
  if (!copilot) notFound()

  const project = getProject(copilot.projectId)

  return (
    <div>
      <AgentPageHeader
        title={copilot.name}
        description={copilot.description}
        meta={
          <>
            <StatusBadge status={copilot.status} />
            <RuntimeBadge runtime={copilot.runtime} />
            <span className="font-mono text-xs tabular-nums text-zinc-400">{copilot.model}</span>
            {project ? <span className="text-xs text-zinc-500">{project.name}</span> : null}
          </>
        }
        actions={
          /* No tracing dashboard in V1 — visibly inert, never a dead '#' link. */
          <Button outline disabled title="Tracing dashboard ships in V2">
            View traces
            <span className="sr-only"> (coming soon)</span>
          </Button>
        }
      />

      <div className="mt-6">
        <CopilotTabs copilotId={id} />
      </div>

      <div className="mt-6 lg:mt-8">{children}</div>
    </div>
  )
}
