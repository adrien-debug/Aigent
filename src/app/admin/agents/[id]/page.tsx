import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AgentDetailScreen } from '@/components/console/agent-detail-screen'
import { getAgentDetail } from '@/lib/agent-mission-control/agent-detail'

export const metadata: Metadata = { title: 'Agent — Aigent' }

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const detail = await getAgentDetail(id)
  if (!detail) notFound()
  return <AgentDetailScreen detail={detail} />
}
