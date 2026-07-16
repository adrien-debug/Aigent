'use client'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { Text } from '@/components/catalyst/text'

/** The LangGraph debug metadata a builder run carries (mirror of BuilderRunState.langgraph). */
export interface LangGraphDebugInfo {
  graph: string
  assistantId: string | null
  agentServerUrl: string
  threadId: string
}

/**
 * LangGraph Debug — an operator-facing panel that makes the Aigent ↔ LangGraph
 * correspondence explicit: which graph ran, on which Agent Server, under which
 * assistant, and the thread id (= the run id) that keys the run's state.
 *
 * It builds the LangGraph Studio deep-link (hosted Studio at smith.langchain.com
 * pointed at THIS Agent Server — works for the local dev server AND the prod
 * server agent.hearst.app), plus in-app links to the LangGraph run explorer and
 * this exact thread. Shows only non-secret values — the Agent Server URL and ids
 * are safe; no token/`x-agent-key`/header is ever rendered.
 */
export function LangGraphDebugPanel({ info, status }: { info: LangGraphDebugInfo; status: string }) {
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(info.agentServerUrl)}`
  // Offer the Studio deep-link for any real http(s) Agent Server — the local dev
  // server (127.0.0.1/localhost) OR the prod server (agent.hearst.app). Studio
  // just needs a reachable baseUrl; there's no reason to hide it for prod.
  const hasServer = /^https?:\/\/.+/.test(info.agentServerUrl)

  return (
    <AgentSectionCard
      title="LangGraph debug"
      description="Where this run actually executes — correlate Aigent with the LangGraph Agent Server."
    >
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        <Row label="Graph" value={info.graph} mono />
        <Row label="Status" value={status} />
        <Row label="Thread id (= run id)" value={info.threadId} mono />
        <Row label="Assistant id" value={info.assistantId ?? 'bare graph (no dedicated assistant)'} mono />
        <Row label="Agent Server" value={info.agentServerUrl} mono />
      </dl>

      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">
        {hasServer ? (
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-11 items-center py-2 text-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300 dark:hover:text-accent-200"
          >
            Open in LangGraph Studio →
          </a>
        ) : null}
      </div>

      <Text className="mt-3 !text-xs">
        Runs execute on the Agent Server above (the prod server in production). Aigent is the durable operator view;
        LangGraph Runs lists the live threads, and Studio opens the graph visually.
      </Text>
    </AgentSectionCard>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  )
}
