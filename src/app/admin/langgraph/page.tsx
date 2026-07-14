import { Suspense } from 'react'
import type { Metadata } from 'next'

import { LangGraphExplorerView } from '@/components/agent-ops/langgraph-explorer-view'
import { explorerServerInfo } from '@/lib/agent-mission-control/langgraph-explorer'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'
import clsx from 'clsx'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'LangGraph Topology — Aigent',
}

export default function LangGraphRunsPage() {
  const { agentServerUrl, graph } = explorerServerInfo()
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(agentServerUrl)}`

  return (
    <div className="flex flex-col h-[calc(100vh-80px)]">
      <StaggerFade delay={0} className="flex flex-1 flex-col min-h-0">
        <div className={clsx(surfaceCardClass, 'flex flex-1 flex-col min-h-0')}>
          <div className="border-b border-white/5 bg-black/20 px-6 py-6 lg:px-8">
            <h1 className="text-4xl font-bold tracking-tight text-white sm:text-5xl">LangGraph</h1>
          </div>
          <Suspense fallback={null}>
            <div className="flex flex-1 flex-col min-h-0">
              <LangGraphExplorerView agentServerUrl={agentServerUrl} graph={graph} studioUrl={studioUrl} />
            </div>
          </Suspense>
        </div>
      </StaggerFade>
    </div>
  )
}
