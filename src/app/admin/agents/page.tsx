import type { Metadata } from 'next'

import { AgentsScreen } from '@/components/console/agents-screen'
import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'

export const metadata: Metadata = { title: 'Agents — Aigent' }

export default async function AgentsPage() {
  return <AgentsScreen agents={await getAvailableAgents()} />
}
