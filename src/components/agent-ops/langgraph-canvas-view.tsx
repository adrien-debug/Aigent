'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { Text } from '@/components/catalyst/text'

// Redacted shapes (mirror of langgraph-explorer.ts — server routes return these).
interface ExplorerThread {
  threadId: string
  status: string
  createdAt?: string
  assistantId?: string
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

// The agent_builder graph is fixed and known — this is a read-only VIEW of it,
// not an editor. Node positions are static (atomic pass: no drag/drop).
type NodeId = '__start__' | 'agent' | 'approval' | 'tools' | '__end__'
interface CanvasNode {
  id: NodeId
  label: string
  role: string
  x: number
  y: number
}
const NODES: CanvasNode[] = [
  { id: '__start__', label: '__start__', role: 'Entry point — the run begins here.', x: 300, y: 40 },
  { id: 'agent', label: 'agent', role: 'ChatOpenAI bound to the copilot tools. Decides the next tool call or the final answer.', x: 300, y: 150 },
  { id: 'approval', label: 'approval', role: 'Human-in-the-loop gate. interrupt()s before a confirmation-required tool (draft_copilot_spec).', x: 120, y: 270 },
  { id: 'tools', label: 'tools', role: 'Executes the approved tool call (read-only tools + the gated draft tool), then loops back to agent.', x: 300, y: 390 },
  { id: '__end__', label: '__end__', role: 'Terminal node — the run finished (final answer produced).', x: 480, y: 270 },
]
// Edges as [from, to, dashed?]. Dashed = conditional edge.
const EDGES: [NodeId, NodeId, boolean][] = [
  ['__start__', 'agent', false],
  ['agent', 'approval', true], // conditional: tool call requested
  ['agent', '__end__', true], // conditional: no tool call → end
  ['approval', 'tools', true], // approved
  ['approval', 'agent', true], // declined → back to agent
  ['tools', 'agent', false], // loop
]

type NodeStatus = 'idle' | 'active' | 'completed' | 'interrupted' | 'error'

const NODE_W = 132
const NODE_H = 44
const VB_W = 640
const VB_H = 470

/**
 * LangGraph Canvas — a read-only operator view of the agent_builder graph.
 * Renders the fixed node/edge topology as a static SVG, highlights the active
 * node for the selected thread (interrupted → approval; else currentNode), and
 * shows a right-hand inspector with the node role + thread state / interrupt /
 * messages / tool calls. No graph editing, no write to LangGraph — all data
 * comes from the server-only /api/agent-ops/langgraph/* routes.
 */
export function LangGraphCanvasView({ graph, studioUrl }: { graph: string; studioUrl: string }) {
  const searchParams = useSearchParams()
  const initialThreadId = searchParams.get('threadId')

  const [threads, setThreads] = useState<ExplorerThread[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedThread, setSelectedThread] = useState<string | null>(initialThreadId)
  const [detail, setDetail] = useState<ExplorerThreadDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  // Which node the inspector shows. Defaults to the active node once a detail loads.
  const [selectedNode, setSelectedNode] = useState<NodeId | null>(null)

  const loadDetail = useCallback(async (threadId: string) => {
    setSelectedThread(threadId)
    setDetailLoading(true)
    setDetailError(null)
    setDetail(null)
    setSelectedNode(null)
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
        const res = await fetch('/api/agent-ops/langgraph/threads')
        const data = await res.json().catch(() => null)
        if (!live) return
        if (!res.ok) {
          setListError(data?.error ?? `Failed to list threads (${res.status}).`)
          return
        }
        const list = (data.threads as ExplorerThread[]) ?? []
        setThreads(list)
        // Open the URL thread if given, else the most recent interrupted one, else the newest.
        const target = initialThreadId ?? list.find((t) => t.status === 'interrupted')?.threadId ?? list[0]?.threadId ?? null
        if (target) await loadDetail(target)
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

  // Derive each node's status from the thread detail — never a fabricated active node.
  const nodeStatus = useMemo<Record<NodeId, NodeStatus>>(() => {
    const base: Record<NodeId, NodeStatus> = {
      __start__: 'idle',
      agent: 'idle',
      approval: 'idle',
      tools: 'idle',
      __end__: 'idle',
    }
    if (!detail) return base
    const s = detail.status
    const interrupted = s === 'interrupted' || detail.interrupts.length > 0
    // The active node: interrupted → approval; else the reported currentNode.
    const activeId = interrupted
      ? 'approval'
      : (['__start__', 'agent', 'approval', 'tools', '__end__'] as NodeId[]).find((n) => detail.currentNode?.split(',').map((x) => x.trim()).includes(n)) ?? null
    if (activeId) base[activeId] = interrupted && activeId === 'approval' ? 'interrupted' : 'active'
    if (s === 'error') base.agent = 'error'
    // A finished run (idle with a final answer, no interrupt) → __end__ completed.
    if (!interrupted && (s === 'idle' || s === 'success') && detail.messages.length > 0 && !activeId) {
      base.__end__ = 'completed'
    }
    return base
  }, [detail])

  // The node the inspector shows: an explicit click wins; otherwise it follows
  // the active node (interrupted/active) once a thread is loaded — derived, not
  // stored, so there's no setState-in-effect cascade.
  const activeNodeId = useMemo<NodeId | null>(() => {
    const entry = (Object.entries(nodeStatus) as [NodeId, NodeStatus][]).find(([, st]) => st === 'active' || st === 'interrupted' || st === 'error')
    return entry?.[0] ?? (detail ? 'agent' : null)
  }, [nodeStatus, detail])
  const effectiveNodeId = selectedNode ?? activeNodeId
  const inspectorNode = effectiveNodeId ? NODES.find((n) => n.id === effectiveNodeId) ?? null : null

  return (
    <div className="space-y-6">
      {/* Thread selector + Studio link */}
      <AgentSectionCard title="Thread" description="Pick a run to visualise on the graph.">
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <Text className="!mt-0">Loading threads…</Text>
          </div>
        ) : listError ? (
          <ErrorBanner message={listError} />
        ) : threads.length > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-64">
              <Select
                name="thread"
                value={selectedThread ?? ''}
                onChange={(e) => loadDetail(e.target.value)}
                aria-label="Select a thread"
              >
                {threads.map((t) => (
                  <option key={t.threadId} value={t.threadId}>
                    {t.threadId.slice(0, 20)}… · {t.status}
                  </option>
                ))}
              </Select>
            </div>
            <a
              href={studioUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300 dark:hover:text-accent-200"
            >
              Open in LangGraph Studio →
            </a>
            <Link href="/admin/langgraph" className="text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
              Back to LangGraph Runs
            </Link>
          </div>
        ) : (
          <Text>No threads on the server yet.</Text>
        )}
      </AgentSectionCard>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Canvas */}
        <AgentSectionCard title="Graph canvas" description={`${graph} · ${detail ? statusLabel(detail.status) : 'select a thread'}`}>
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label={`${graph} graph`}>
              {/* Edges first (under nodes) */}
              {EDGES.map(([from, to, dashed], i) => {
                const a = NODES.find((n) => n.id === from)!
                const b = NODES.find((n) => n.id === to)!
                return <Edge key={i} a={a} b={b} dashed={dashed} />
              })}
              {/* Nodes */}
              {NODES.map((n) => (
                <NodeBox
                  key={n.id}
                  node={n}
                  status={nodeStatus[n.id]}
                  selected={effectiveNodeId === n.id}
                  onSelect={() => setSelectedNode(n.id)}
                />
              ))}
            </svg>
          </div>
          {/* Legend */}
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <LegendDot className="bg-zinc-400 dark:bg-zinc-500" label="idle" />
            <LegendDot className="bg-accent-500" label="active" />
            <LegendDot className="bg-accent-600" label="interrupted (awaiting approval)" />
            <LegendDot className="bg-zinc-700 dark:bg-zinc-300" label="completed" />
            <LegendDot className="bg-accent-700" label="error" />
          </div>
        </AgentSectionCard>

        {/* Inspector */}
        <AgentSectionCard title="Inspector" description={inspectorNode ? inspectorNode.label : 'node / run detail'}>
          {detailLoading ? (
            <div className="flex items-center gap-2">
              <Spinner /> <Text className="!mt-0">Reading state…</Text>
            </div>
          ) : detailError ? (
            <ErrorBanner message={detailError} />
          ) : detail && inspectorNode ? (
            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Node</p>
                <p className="font-mono text-zinc-950 dark:text-white">{inspectorNode.label}</p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{inspectorNode.role}</p>
              </div>
              <dl className="grid grid-cols-1 gap-y-2">
                <Row label="Node status" value={statusLabel(nodeStatus[inspectorNode.id])} />
                <Row label="Thread status" value={statusLabel(detail.status)} />
                <Row label="Current node" value={detail.currentNode ?? 'not available'} mono />
                <Row label="Thread id" value={detail.threadId} mono />
                <Row label="Graph" value={detail.graph ?? graph} mono />
                <Row label="Assistant id" value={detail.assistantId ?? 'not available'} mono />
              </dl>

              {/* Approval node: interrupt payload */}
              {inspectorNode.id === 'approval' && detail.interrupts.length > 0 ? (
                <div className="rounded-lg bg-[var(--copper-soft)] p-3 ring-1 ring-[var(--copper-line)]">
                  <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                    Awaiting human approval
                  </p>
                  <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {JSON.stringify(detail.interrupts, null, 2)}
                  </pre>
                </div>
              ) : inspectorNode.id === 'approval' ? (
                <Text className="!text-xs">No pending interrupt on this thread.</Text>
              ) : null}

              {/* Tools node: tool calls across messages */}
              {inspectorNode.id === 'tools' ? (
                (() => {
                  const calls = detail.messages.flatMap((m) => m.toolCalls ?? [])
                  return calls.length > 0 ? (
                    <div>
                      <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tool calls</p>
                      <ul className="mt-1.5 flex flex-wrap gap-1.5">
                        {calls.map((c, i) => (
                          <li key={i} className="rounded-md bg-zinc-950/5 px-2 py-1 font-mono text-xs dark:bg-white/5">{c}</li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <Text className="!text-xs">No tool calls recorded on this thread.</Text>
                  )
                })()
              ) : null}

              {/* Recent messages (all nodes) */}
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Recent messages ({detail.messages.length})</p>
                {detail.messages.length > 0 ? (
                  <ul className="mt-1.5 space-y-2">
                    {detail.messages.slice(-4).map((m, i) => (
                      <li key={i} className="border-b border-zinc-950/5 pb-2 last:border-0 dark:border-white/5">
                        <p className="text-xs font-medium text-accent-700 dark:text-accent-300">{m.role}</p>
                        <p className="line-clamp-4 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{m.content || '—'}</p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Text className="!text-xs">not available</Text>
                )}
              </div>
            </div>
          ) : (
            <Text>Select a thread, then click a node to inspect it.</Text>
          )}
        </AgentSectionCard>
      </div>
    </div>
  )
}

// --- SVG pieces ------------------------------------------------------------

function NodeBox({
  node,
  status,
  selected,
  onSelect,
}: {
  node: CanvasNode
  status: NodeStatus
  selected: boolean
  onSelect: () => void
}) {
  const fill =
    status === 'interrupted'
      ? 'var(--copper-surface)'
      : status === 'active'
        ? 'var(--copper-soft)'
        : 'transparent'
  const stroke =
    status === 'interrupted' || status === 'active'
      ? 'var(--copper-line)'
      : status === 'error'
        ? 'rgb(180 83 9)'
        : status === 'completed'
          ? 'rgb(113 113 122)'
          : 'rgb(161 161 170)'
  return (
    <g
      transform={`translate(${node.x - NODE_W / 2}, ${node.y - NODE_H / 2})`}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      className="cursor-pointer focus:outline-none"
      aria-label={`${node.label} — ${status}`}
    >
      <rect
        width={NODE_W}
        height={NODE_H}
        rx={10}
        fill={fill}
        stroke={stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        className="fill-white dark:fill-zinc-950"
        style={fill !== 'transparent' ? { fill } : undefined}
      />
      <text
        x={NODE_W / 2}
        y={NODE_H / 2 - 3}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-zinc-950 font-mono text-[13px] dark:fill-white"
      >
        {node.label}
      </text>
      <text
        x={NODE_W / 2}
        y={NODE_H / 2 + 12}
        textAnchor="middle"
        dominantBaseline="middle"
        className="fill-zinc-500 text-[9px] uppercase dark:fill-zinc-400"
      >
        {status}
      </text>
    </g>
  )
}

function Edge({ a, b, dashed }: { a: CanvasNode; b: CanvasNode; dashed: boolean }) {
  // Anchor from box edge to box edge (simple straight line, offset at box border).
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const offA = NODE_H / 2 + 2
  const offB = NODE_H / 2 + 8
  const x1 = a.x + (dx / len) * offA
  const y1 = a.y + (dy / len) * offA
  const x2 = b.x - (dx / len) * offB
  const y2 = b.y - (dy / len) * offB
  return (
    <g>
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="rgb(161 161 170)"
        strokeWidth={1.5}
        strokeDasharray={dashed ? '5 4' : undefined}
        markerEnd="url(#arrow)"
      />
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(161 161 170)" />
        </marker>
      </defs>
    </g>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${className}`} />
      {label}
    </span>
  )
}

function statusLabel(s: string): string {
  const t = s.replace(/[-_]/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  )
}
