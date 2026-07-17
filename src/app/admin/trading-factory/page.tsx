import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { TradingRoster } from '@/components/agent-ops/trading/trading-roster'
import {
  summarizeRoster,
  toAgentVM,
} from '@/components/agent-ops/trading/roster-view-model'
import { ROSTER } from '@/lib/agent-mission-control/market/agents/roster'

// Static, offline data (the market roster is pure typed data — roster.ts).
// force-dynamic keeps parity with the rest of /admin (never prerendered).
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Trading Factory — Aigent',
}

export default function TradingFactoryPage() {
  const agents = ROSTER.map(toAgentVM)
  const summary = summarizeRoster(agents)

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AgentPageHeader
          breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Trading Factory' }]}
          environment="Market gamme"
          title="Trading Agent Factory"
          description="The founding gamme of six read-only ETH trading copilots — typed definitions only. None is materialized into a live copilot yet: each is Experimental, not matérialisé."
        />
      </StaggerFade>

      <StaggerFade delay={1}>
        <TradingRoster agents={agents} summary={summary} />
      </StaggerFade>
    </div>
  )
}
