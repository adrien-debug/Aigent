'use client'

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'

// Redacted shapes (mirror of langgraph-explorer.ts).
interface ExplorerAssistant {
  assistantId: string
  name?: string
  graphId?: string
  createdAt?: string
  updatedAt?: string
}
interface ExplorerThread {
  threadId: string
  status: string
  createdAt?: string
  updatedAt?: string
  assistantId?: string
  graph?: string
}
interface ExplorerThreadDetail {
  threadId: string
  status: string
  currentNode: string | null
  interrupts: unknown[]
  messages: { role: string; content: string; toolCalls?: string[] }[]
  assistantId?: string
  graph?: string
}

const AGENT_BUILDER_SLUG_HINT = 'Agent Builder'

/** Short id — full ids are long UUIDs; show a readable prefix + full on hover. */
function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id
}

/**
 * LangGraph Runs explorer — lists the REAL assistants + threads/runs on the
 * Agent Server the app uses (agent.hearst.app in prod), and reads one thread's
 * state on click. Everything is read-only, fetched from the server-only routes
 * (no secret ever reaches this client). A `?threadId=` in the URL auto-opens
 * that thread (the link the Builder debug panel emits).
 */
export function LangGraphExplorerView({
  agentServerUrl,
  graph,
  studioUrl,
}: {
  agentServerUrl: string
  graph: string
  studioUrl: string
}) {
  const searchParams = useSearchParams()
  const initialThreadId = searchParams.get('threadId')

  const [assistants, setAssistants] = useState<ExplorerAssistant[]>([])
  const [threads, setThreads] = useState<ExplorerThread[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [selected, setSelected] = useState<string | null>(initialThreadId)
  const [detail, setDetail] = useState<ExplorerThreadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Map assistantId → name, so a thread's assistant reads as a copilot name.
  const assistantName = new Map(assistants.map((a) => [a.assistantId, a.name]))

  const loadDetail = useCallback(async (threadId: string) => {
    setSelected(threadId)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    try {
      const res = await fetch(`/api/agent-ops/langgraph/threads/${encodeURIComponent(threadId)}`)
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setDetailError(data?.error ?? `Failed to read thread (${res.status}).`)
        return
      }
      setDetail(data as ExplorerThreadDetail)
    } catch {
      setDetailError('LangGraph Agent Server not reachable.')
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    async function load() {
      setLoading(true)
      setListError(null)
      try {
        const [aRes, tRes] = await Promise.all([
          fetch('/api/agent-ops/langgraph/assistants'),
          fetch('/api/agent-ops/langgraph/threads'),
        ])
        const aData = await aRes.json().catch(() => null)
        const tData = await tRes.json().catch(() => null)
        if (!live) return
        if (!aRes.ok) {
          setListError(aData?.error ?? `Failed to list assistants (${aRes.status}).`)
          return
        }
        if (!tRes.ok) {
          setListError(tData?.error ?? `Failed to list threads (${tRes.status}).`)
          return
        }
        setAssistants((aData.assistants as ExplorerAssistant[]) ?? [])
        setThreads((tData.threads as ExplorerThread[]) ?? [])
        // Auto-open the thread named in the URL (the Builder debug-panel link),
        // once the lists are in — done inside this async load, not a separate
        // synchronous-setState effect, so it's a natural sequenced fetch.
        if (initialThreadId) await loadDetail(initialThreadId)
      } catch {
        if (live) setListError('LangGraph Agent Server not reachable.')
      } finally {
        if (live) setLoading(false)
      }
    }
    load()
    return () => {
      live = false
    }
  }, [initialThreadId, loadDetail])

  return (
    <div className="space-y-6">
      {/* Server + graph header cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        <AgentSectionCard title="Agent Server" description="Where runs execute">
          <p className="font-mono text-xs break-all text-zinc-950 dark:text-white">{agentServerUrl}</p>
        </AgentSectionCard>
        <AgentSectionCard title="Graph" description="The shared LangGraph graph">
          <p className="font-mono text-sm text-zinc-950 dark:text-white">{graph}</p>
        </AgentSectionCard>
        <AgentSectionCard title="LangGraph Studio" description="Open the graph visually">
          <a
            href={studioUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300 dark:hover:text-accent-200"
          >
            Open in LangGraph Studio →
          </a>
        </AgentSectionCard>
      </div>

      {listError ? <ErrorBanner message={listError} /> : null}

      {/* Assistants */}
      <AgentSectionCard
        title="Assistants"
        description="One per copilot, on the shared agent_builder graph"
        actions={<span className="text-xs text-zinc-500 tabular-nums">{assistants.length}</span>}
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <Text className="!mt-0">Loading…</Text>
          </div>
        ) : assistants.length > 0 ? (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Assistant id</TableHeader>
                <TableHeader>Graph</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {assistants.map((a) => (
                <TableRow key={a.assistantId}>
                  <TableCell>{a.name ?? '—'}</TableCell>
                  <TableCell>
                    <span title={a.assistantId} className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                      {shortId(a.assistantId)}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{a.graphId ?? graph}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text>No assistants on the server.</Text>
        )}
      </AgentSectionCard>

      {/* Threads / runs */}
      <AgentSectionCard
        title="Recent threads / runs"
        description="Live LangGraph threads — click one to read its state"
        actions={<span className="text-xs text-zinc-500 tabular-nums">{threads.length}</span>}
      >
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <Text className="!mt-0">Loading…</Text>
          </div>
        ) : threads.length > 0 ? (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Thread id (= run id)</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Assistant</TableHeader>
                <TableHeader>Created</TableHeader>
                <TableHeader className="text-right">State</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {threads.map((t) => (
                <TableRow key={t.threadId} className={selected === t.threadId ? 'bg-[var(--copper-soft)]' : undefined}>
                  <TableCell>
                    <span title={t.threadId} className="font-mono text-xs text-zinc-950 dark:text-white">
                      {shortId(t.threadId)}
                    </span>
                  </TableCell>
                  <TableCell>{statusLabel(t.status)}</TableCell>
                  <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">
                    {t.assistantId ? assistantName.get(t.assistantId) ?? shortId(t.assistantId) : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-zinc-500 dark:text-zinc-400">{formatWhen(t.createdAt)}</TableCell>
                  <TableCell className="text-right">
                    <Button plain onClick={() => loadDetail(t.threadId)}>
                      View
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <Text>No threads on the server yet — run the Agent Builder to create one.</Text>
        )}
      </AgentSectionCard>

      {/* Thread detail */}
      {selected ? (
        <AgentSectionCard
          title="Thread detail"
          description={selected}
        >
          {detailLoading ? (
            <div className="flex items-center gap-2">
              <Spinner /> <Text className="!mt-0">Reading state…</Text>
            </div>
          ) : detailError ? (
            <ErrorBanner message={detailError} />
          ) : detail ? (
            <div className="space-y-4">
              <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
                <Row label="Status" value={statusLabel(detail.status)} />
                <Row label="Current node" value={detail.currentNode ?? '— (finished)'} mono />
                <Row label="Assistant" value={detail.assistantId ? assistantName.get(detail.assistantId) ?? detail.assistantId : '—'} />
                <Row label="Graph" value={detail.graph ?? graph} mono />
              </dl>

              {detail.assistantId && (assistantName.get(detail.assistantId) ?? '').includes(AGENT_BUILDER_SLUG_HINT) ? (
                <Link href="/admin/agents" className="inline-flex text-sm font-medium text-accent-700 hover:text-accent-600 dark:text-accent-300">
                  Back to Agent Builder →
                </Link>
              ) : null}

              {detail.interrupts.length > 0 ? (
                <div className="rounded-lg bg-[var(--copper-soft)] p-4 ring-1 ring-[var(--copper-line)]">
                  <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                    Interrupt — awaiting human approval
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {JSON.stringify(detail.interrupts, null, 2)}
                  </pre>
                </div>
              ) : null}

              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Messages ({detail.messages.length})</p>
                <ul className="mt-2 space-y-2">
                  {detail.messages.map((m, i) => (
                    <li key={i} className="border-b border-zinc-950/5 pb-2 last:border-0 dark:border-white/5">
                      <p className="text-xs font-medium text-accent-700 dark:text-accent-300">{m.role}</p>
                      <p className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{m.content || '—'}</p>
                      {m.toolCalls ? (
                        <p className="mt-1 font-mono text-xs text-zinc-500 dark:text-zinc-400">tools: {m.toolCalls.join(', ')}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <Text>Select a thread to read its state.</Text>
          )}
        </AgentSectionCard>
      ) : null}
    </div>
  )
}

function statusLabel(s: string): string {
  const t = s.replace(/[-_]/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** Relative-free absolute-ish label (no Date.now() dependence for SSR safety on client). */
function formatWhen(iso?: string): string {
  if (!iso) return '—'
  // Show the ISO date + time-of-day, trimmed — good enough for an ops list.
  return iso.replace('T', ' ').slice(0, 19)
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  )
}
