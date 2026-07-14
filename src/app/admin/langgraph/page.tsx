import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LangGraphExplorerView } from '@/components/agent-ops/langgraph-explorer-view'
import { explorerServerInfo } from '@/lib/agent-mission-control/langgraph-explorer'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'LangGraph Topology — Aigent',
}

export default function LangGraphRunsPage() {
  const { agentServerUrl, graph } = explorerServerInfo()
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(agentServerUrl)}`

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <Suspense fallback={null}>
        <StaggerFade delay={1} className="flex-1 flex flex-col min-h-0">
          <LangGraphExplorerView agentServerUrl={agentServerUrl} graph={graph} studioUrl={studioUrl} />
        </StaggerFade>
      </Suspense>
    </div>
  )
}
