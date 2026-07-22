import { notFound } from 'next/navigation'
import { AgentDetailHeader } from '@/components/agent-ops/agent-detail/agent-detail-header'
import { AgentDetailNav } from '@/components/agent-ops/agent-detail/agent-detail-nav'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

/**
 * Agent detail shell (AIGENT-AGENT-PAGES-021).
 *
 * Resolves the canonical detail ONCE and renders the header + section nav for
 * every subsection. `getAgentDetail` is request-cached through the `data.ts`
 * getters, so a section page calling it again does not re-query.
 */
export default async function AgentDetailLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  return (
    <div>
      <AgentDetailHeader detail={detail} />
      <div className="mt-6">
        <AgentDetailNav copilotId={id} />
      </div>
      <div className="mt-6 lg:mt-8">{children}</div>
    </div>
  )
}
