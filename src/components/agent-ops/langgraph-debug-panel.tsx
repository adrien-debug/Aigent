'use client'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
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
 * It also builds the LangGraph Studio deep-link (the hosted Studio at
 * smith.langchain.com pointed at THIS Agent Server) — the way to open the run's
 * graph visually. Shows only non-secret values: the Agent Server URL is the
 * localhost dev address; no token/secret is ever rendered.
 */
export function LangGraphDebugPanel({ info, status }: { info: LangGraphDebugInfo; status: string }) {
  const studioUrl = `https://smith.langchain.com/studio/?baseUrl=${encodeURIComponent(info.agentServerUrl)}`
  // Only surface a Studio deep-link for a local Agent Server — a remote/public
  // base URL is not exposed here (dev/operator convenience only).
  const isLocal = /(^https?:\/\/)(127\.0\.0\.1|localhost)(:|\/|$)/.test(info.agentServerUrl)

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
      {isLocal ? (
        <div className="mt-4 space-y-1.5">
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex text-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300 dark:hover:text-accent-200"
          >
            Open in LangGraph Studio →
          </a>
          <Text className="!text-xs">
            The <code className="font-mono">langgraphjs dev</code> server keeps threads/runs in memory only — a run is
            reachable by its thread id within the same server session, and drops on restart. Aigent is the durable
            source of truth for a run&apos;s state.
          </Text>
        </div>
      ) : null}
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
