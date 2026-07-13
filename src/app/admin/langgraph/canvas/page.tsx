import { Suspense } from 'react'
import type { Metadata } from 'next'

import { ChevronLeftIcon } from '@heroicons/react/16/solid'

import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { LangGraphCanvasView } from '@/components/agent-ops/langgraph-canvas-view'
import { Link } from '@/components/catalyst/link'
import { explorerServerInfo } from '@/lib/agent-mission-control/langgraph-explorer'

export const metadata: Metadata = {
  title: 'LangGraph Canvas — Agent Mission Control',
}

/**
 * /admin/langgraph/canvas — a read-only canvas view of the agent_builder graph.
 *
 * Renders the fixed node/edge topology, highlights the active node for the
 * selected thread, and shows an inspector. Data comes from the server-only
 * /api/agent-ops/langgraph/* routes (no secret reaches the client). The graph
 * name + Studio URL are resolved server-side.
 */
export default function LangGraphCanvasPage() {
  const { agentServerUrl, graph } = explorerServerInfo()
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(agentServerUrl)}`

  return (
    <div className="space-y-8">
      <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
        <Link
          href="/admin/langgraph"
          className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
        >
          <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
          LangGraph Runs
        </Link>
      </nav>

      <AgentPageHeader
        title="LangGraph Canvas"
        description="The agent_builder graph, visualised — active node + run inspector."
        className="mt-3"
      />

      {/* useSearchParams (for ?threadId=) requires a Suspense boundary in Next 16. */}
      <Suspense fallback={null}>
        <LangGraphCanvasView graph={graph} studioUrl={studioUrl} />
      </Suspense>
    </div>
  )
}
