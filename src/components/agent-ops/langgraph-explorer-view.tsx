'use client'

import * as Headless from '@headlessui/react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { ServerStackIcon, CpuChipIcon, BoltIcon, ArrowTopRightOnSquareIcon, ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'
import { Link } from '@/components/catalyst/link'
import clsx from 'clsx'

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

function shortId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 16)}…` : id
}

// Thread status → badge classes. Differentiate by INTENSITY within the
// accent/zinc doctrine, not by hue: error/interrupted get the strongest
// accent treatment (attention), running/busy get a plain accent surface
// (in progress), idle/finished states fall back to neutral zinc — mirrors
// the completed/active/interrupted/error/idle vocabulary already used by
// the canvas view's StatusDot/NodeBox for the same graph.
function statusClass(status: string): string {
  switch (status) {
    case 'error':
    case 'interrupted':
      return 'text-accent-300 bg-[var(--accent-surface)] ring-[var(--accent-line-strong)]'
    case 'running':
    case 'busy':
      return 'text-accent-400 bg-[var(--accent-soft)] ring-[var(--accent-line)]'
    case 'idle':
    default:
      return 'text-zinc-400 bg-white/5 ring-white/10'
  }
}

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

  const assistantName = new Map((Array.isArray(assistants) ? assistants : []).map((a) => [a.assistantId, a.name]))

  const loadDetail = useCallback(async (threadId: string) => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const res = await fetch(`/api/agent-ops/langgraph/threads/${encodeURIComponent(threadId)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetail(data)
      setSelected(threadId)
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const [aRes, tRes] = await Promise.all([
          fetch('/api/agent-ops/langgraph/assistants'),
          fetch('/api/agent-ops/langgraph/threads'),
        ])
        if (!aRes.ok) throw new Error(`Assistants HTTP ${aRes.status}`)
        if (!tRes.ok) throw new Error(`Threads HTTP ${tRes.status}`)
        const [aData, tData]: [unknown, unknown] = await Promise.all([aRes.json(), tRes.json()])
        if (!active) return
        const assistantsList = (aData as { assistants?: unknown } | null)?.assistants
        const threadsList = (tData as { threads?: unknown } | null)?.threads
        setAssistants(Array.isArray(assistantsList) ? assistantsList : [])
        setThreads(Array.isArray(threadsList) ? threadsList : [])
      } catch (err) {
        if (active) setListError(err instanceof Error ? err.message : String(err))
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (initialThreadId && selected !== initialThreadId) {
      // Avoid calling setState synchronously by wrapping in a microtask
      Promise.resolve().then(() => {
        loadDetail(initialThreadId).catch(console.error)
      })
    }
  }, [initialThreadId, loadDetail, selected])

  return (
    <div className="flex flex-col gap-6">
      {/* Topology Connection Band */}
      <div className={clsx('flex flex-col md:flex-row items-stretch', surfaceCardClass)}>
        <div className="flex-1 p-6 flex flex-col gap-4 border-b md:border-b-0 md:border-r border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] ring-1 ring-[var(--accent-line)]">
              <ServerStackIcon className="size-5 text-accent-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">Agent Server</span>
              <span className="text-xs font-mono text-zinc-400">{agentServerUrl}</span>
            </div>
          </div>
        </div>
        <div className="flex-1 p-6 flex flex-col gap-4 border-b md:border-b-0 md:border-r border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-soft)] ring-1 ring-[var(--accent-line)]">
              <CpuChipIcon className="size-5 text-accent-400" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-semibold text-white">Shared Graph</span>
              <span className="text-xs font-mono text-zinc-400">{graph}</span>
            </div>
          </div>
          <Link
            href="/admin/langgraph/canvas"
            className="mt-1 inline-flex text-xs font-medium text-accent-400 hover:text-accent-300 transition-colors"
          >
            Open Canvas view &rarr;
          </Link>
        </div>
        <div className="flex-1 p-6 flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-sm font-semibold text-white">LangGraph Studio</span>
            <span className="text-xs text-zinc-400">Deep-link to external UI</span>
          </div>
          <a
            href={studioUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex size-10 items-center justify-center rounded-xl bg-white/5 hover:bg-white/10 text-white ring-1 ring-white/10 transition-colors"
            title="Open LangGraph Studio"
          >
            <ArrowTopRightOnSquareIcon className="size-5" />
          </a>
        </div>
      </div>

      {listError ? (
        <ErrorBanner message={`Failed to load LangGraph state: ${listError}`} />
      ) : loading ? (
        <div className="flex items-center justify-center py-24 rounded-2xl border border-white/5 border-dashed bg-white/[0.01]">
          <Spinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Threads List */}
          <div className={clsx('flex flex-col', surfaceCardClass)}>
            <div className="p-4 border-b border-white/5 bg-black/20">
              <h2 className="text-sm font-semibold text-white">Recent Threads</h2>
            </div>
            <div className="flex flex-col max-h-[600px] overflow-y-auto">
              {(!Array.isArray(threads) || threads.length === 0) ? (
                <EmptyState icon={ChatBubbleLeftRightIcon} title="No threads found" />
              ) : (
                threads.map(thread => (
                  <Headless.Button
                    key={thread.threadId}
                    onClick={() => loadDetail(thread.threadId)}
                    className={clsx(
                      "flex flex-col gap-2 p-4 border-b border-white/5 text-left transition-colors",
                      selected === thread.threadId ? "bg-[var(--color-surface-interactive)] ring-1 ring-inset ring-[var(--accent-line-strong)]" : "hover:bg-white/5"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="text-sm font-mono text-white truncate" title={thread.threadId}>{shortId(thread.threadId)}</span>
                      <span className={clsx(
                        "text-[10px] font-medium uppercase tracking-widest px-2 py-0.5 rounded-md ring-1",
                        statusClass(thread.status)
                      )}>
                        {thread.status}
                      </span>
                    </div>
                    <div className="flex items-center justify-between w-full text-xs text-zinc-500">
                      <span className="truncate">{thread.assistantId ? (assistantName.get(thread.assistantId) || shortId(thread.assistantId)) : '—'}</span>
                      <span>{thread.updatedAt ? new Date(thread.updatedAt).toLocaleTimeString() : ''}</span>
                    </div>
                  </Headless.Button>
                ))
              )}
            </div>
          </div>

          {/* Thread Detail */}
          <div className={clsx('flex flex-col', surfaceCardClass)}>
            <div className="p-4 border-b border-white/5 bg-black/20">
              <h2 className="text-sm font-semibold text-white">Thread Detail</h2>
            </div>
            <div className="flex-1 p-6 max-h-[600px] overflow-y-auto">
              {!selected ? (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <BoltIcon className="size-8 text-zinc-600 mb-3" />
                  <p className="text-sm text-zinc-400">Select a thread to view its state.</p>
                </div>
              ) : detailLoading ? (
                <div className="flex items-center justify-center h-full">
                  <Spinner />
                </div>
              ) : detailError ? (
                <ErrorBanner message={`Failed to load thread detail: ${detailError}`} />
              ) : detail ? (
                <div className="flex flex-col gap-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">Thread ID</span>
                      <span className="text-sm font-mono text-white">{shortId(detail.threadId)}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">Status</span>
                      <span className="text-sm text-white capitalize">{detail.status}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">Current Node</span>
                      <span className="text-sm font-mono text-accent-400">{detail.currentNode || '—'}</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] uppercase tracking-widest text-zinc-500">Graph</span>
                      <span className="text-sm font-mono text-white">{detail.graph || '—'}</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3">
                    <span className="text-[10px] uppercase tracking-widest text-zinc-500 border-b border-white/5 pb-2">Messages</span>
                    <div className="flex flex-col gap-4">
                      {detail.messages.length === 0 ? (
                        <EmptyState icon={ChatBubbleLeftRightIcon} title="No messages in this thread" className="px-0 py-6" />
                      ) : (
                        detail.messages.map((msg, idx) => (
                          <div key={idx} className={clsx(
                            "flex flex-col gap-2 p-3 rounded-xl border",
                            msg.role === 'user' ? "bg-[var(--color-surface-interactive)] border-white/5 ml-8" : "bg-[var(--accent-soft)] border-[var(--accent-line)] mr-8"
                          )}>
                            <div className="flex items-center justify-between">
                              <span className={clsx("text-[10px] font-bold uppercase tracking-widest", msg.role === 'user' ? "text-zinc-400" : "text-accent-400")}>
                                {msg.role}
                              </span>
                            </div>
                            <p className="text-sm text-zinc-300 whitespace-pre-wrap">{msg.content}</p>
                            {msg.toolCalls && msg.toolCalls.length > 0 && (
                              <div className="mt-2 flex flex-col gap-1">
                                <span className="text-[10px] uppercase tracking-widest text-zinc-500">Tool Calls</span>
                                {msg.toolCalls.map((tc, i) => (
                                  <span key={i} className="text-xs font-mono text-accent-400">{tc}</span>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
