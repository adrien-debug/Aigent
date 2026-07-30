import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AgentDetailScreen } from '@/components/console/agent-detail-screen'
import { ConsoleShell } from '@/components/console/console-shell'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export const metadata: Metadata = { title: 'Agent — Aigent' }

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()

  // `detail.executable` is the run route's own verdict (the blockers mirror its
  // 409 body), so the topbar states the gate rather than a decorative health.
  return (
    <ConsoleShell
      activeHref={`/admin/agents/${id}`}
      title={detail.copilot.name}
      stateLabel={detail.executable ? 'Executable' : 'Execution blocked'}
      stateTone={detail.executable ? 'positive' : 'negative'}
      degraded={!detail.executable}
    >
      <AgentDetailScreen detail={detail} />
    </ConsoleShell>
  )
}
