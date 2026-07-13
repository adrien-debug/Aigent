import { Suspense } from 'react'
import type { Metadata } from 'next'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { LangGraphExplorerView } from '@/components/agent-ops/langgraph-explorer-view'
import { explorerServerInfo } from '@/lib/agent-mission-control/langgraph-explorer'

export const metadata: Metadata = {
  title: 'LangGraph Runs — Agent Mission Control',
}

/**
 * /admin/langgraph — the LangGraph run explorer.
 *
 * Lists the real assistants + threads/runs on the Agent Server the app uses
 * (agent.hearst.app in prod), reads a thread's state on click, and deep-links to
 * LangGraph Studio pointed at that server. All data comes from the server-only
 * read routes under /api/agent-ops/langgraph/* — no secret reaches the client.
 *
 * The server URL + graph are resolved server-side (explorerServerInfo reads the
 * env); the Studio URL is built here so the client never needs the raw config.
 */
export default function LangGraphRunsPage() {
  const { agentServerUrl, graph } = explorerServerInfo()
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(agentServerUrl)}`

  return (
    <div className="space-y-8">
      <AgentPageHeader
        title="LangGraph Runs"
        description="The real assistants, threads and runs on the Agent Server the app uses."
        className="mt-2"
      />
      {/* useSearchParams (for ?threadId=) requires a Suspense boundary in Next 16. */}
      <Suspense fallback={null}>
        <LangGraphExplorerView agentServerUrl={agentServerUrl} graph={graph} studioUrl={studioUrl} />
      </Suspense>
    </div>
  )
}
