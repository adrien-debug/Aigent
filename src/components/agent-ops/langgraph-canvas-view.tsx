'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import * as Headless from '@headlessui/react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/catalyst/button'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { Switch } from '@/components/catalyst/switch'
import { Text } from '@/components/catalyst/text'

// Redacted shapes (mirror of langgraph-explorer.ts — server routes return these).
interface ExplorerThread {
  threadId: string
  status: string
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
interface HistoryStep {
  index: number
  node: string | null
  interrupted: boolean
  createdAt?: string
  messageCount: number
  lastRole?: string
  lastPreview?: string
  toolCalls: string[]
  interrupts: unknown[]
}

// --- agent_builder topology: KNOWN layout + hard-coded FALLBACK --------------
// The replay/status logic keys on the KNOWN node ids (a stable union). The
// canvas RENDERS from the live topology API when available, else this fallback.
type NodeId = '__start__' | 'agent' | 'approval' | 'tools' | '__end__'
const NODE_IDS: NodeId[] = ['__start__', 'agent', 'approval', 'tools', '__end__']

/** A node ready to draw: string id (may be an unknown/new topology node) + layout. */
interface RenderNode {
  id: string
  label: string
  role: string
  type?: string
  x: number
  y: number
}
/** A drawable edge. */
interface RenderEdge {
  source: string
  target: string
  conditional: boolean
}

// Fixed positions + roles for the KNOWN agent_builder nodes. A topology node not
// in here is laid out automatically (see buildLayout). Tuned for a compact,
// centred diamond that fills the viewBox without dead space.
const KNOWN_POSITIONS: Record<NodeId, { x: number; y: number }> = {
  __start__: { x: 300, y: 34 },
  agent: { x: 300, y: 120 },
  approval: { x: 148, y: 210 },
  tools: { x: 300, y: 300 },
  __end__: { x: 452, y: 210 },
}
const NODE_ROLES: Record<NodeId, string> = {
  __start__: 'Entry point — the run begins here.',
  agent: 'ChatOpenAI bound to the copilot tools. Decides the next tool call or the final answer.',
  approval: 'Human-in-the-loop gate. interrupt()s before a confirmation-required tool.',
  tools: 'Executes the approved tool call, then loops back to agent.',
  __end__: 'Terminal node — the run finished (final answer produced).',
}

// Hard-coded FALLBACK topology (used when the server doesn't expose one).
const FALLBACK_NODES: { id: NodeId; type: string }[] = [
  { id: '__start__', type: 'schema' },
  { id: 'agent', type: 'runnable' },
  { id: 'approval', type: 'runnable' },
  { id: 'tools', type: 'runnable' },
  { id: '__end__', type: 'schema' },
]
const FALLBACK_EDGES: RenderEdge[] = [
  { source: '__start__', target: 'agent', conditional: false },
  { source: 'agent', target: 'approval', conditional: true },
  { source: 'agent', target: '__end__', conditional: true },
  { source: 'approval', target: 'tools', conditional: true },
  { source: 'approval', target: 'agent', conditional: true },
  { source: 'tools', target: 'agent', conditional: false },
]

interface TopologyNode {
  id: string
  label: string
  type?: string
}
interface TopologyEdge {
  source: string
  target: string
  conditional?: boolean
}

/** Build the render nodes with layout: known ids get fixed positions; any extra
 * topology node is auto-placed in a spare column so it's visible but never
 * fabricated onto a known spot. */
function buildLayout(nodes: TopologyNode[]): RenderNode[] {
  let extra = 0
  return nodes.map((n) => {
    const known = KNOWN_POSITIONS[n.id as NodeId]
    const pos = known ?? { x: 520, y: 40 + extra++ * 80 }
    return {
      id: n.id,
      label: n.label || n.id,
      role: NODE_ROLES[n.id as NodeId] ?? `Graph node "${n.id}" (${n.type ?? 'node'}).`,
      type: n.type,
      x: pos.x,
      y: pos.y,
    }
  })
}

type StepStatus = 'completed' | 'active' | 'interrupted' | 'error' | 'idle' | 'unknown'

/** A derived replay step for the timeline + overlay. Never fabricated. */
interface ReplayStep {
  id: string
  index: number
  node: NodeId | 'unknown'
  label: string
  status: StepStatus
  timestamp?: string
  summary?: string
}

const NODE_W = 96
const NODE_H = 34
const VB_W = 600
const VB_H = 344

/**
 * PURE mapping: history checkpoints (+ thread detail) → ordered replay steps.
 * Exported-style pure function (no I/O) — the mapping rules live in one place.
 *
 * Rules (never invent a node — unknown stays 'unknown'):
 *  - checkpoint carries an interrupt → node 'approval', status 'interrupted'
 *  - its `next` is a known node → that node, status 'completed' (it's a past
 *    checkpoint; the run has moved on) EXCEPT the last checkpoint which is the
 *    live tip (active/interrupted)
 *  - no history → a single fallback step derived from the thread detail:
 *    interrupted → approval interrupted; idle/finished with messages → __end__
 *    completed; error → agent error; else unknown.
 */
function deriveReplaySteps(detail: ExplorerThreadDetail | null, history: HistoryStep[]): ReplayStep[] {
  if (!detail) return []

  if (history.length > 0) {
    return history.map((h, i) => {
      const isLast = i === history.length - 1
      const known = (NODE_IDS as string[]).includes(h.node ?? '')
      const node: NodeId | 'unknown' = h.interrupted ? 'approval' : known ? (h.node as NodeId) : 'unknown'
      const status: StepStatus = h.interrupted
        ? 'interrupted'
        : isLast
          ? detail.status === 'error'
            ? 'error'
            : detail.status === 'interrupted'
              ? 'interrupted'
              : 'active'
          : 'completed'
      const summary =
        h.toolCalls.length > 0
          ? `→ ${h.toolCalls.join(', ')}`
          : h.lastPreview
            ? `${h.lastRole ?? 'msg'}: ${h.lastPreview}`
            : `${h.messageCount} message(s)`
      return {
        id: `h-${h.index}`,
        index: h.index,
        node,
        label: node === 'unknown' ? `step ${h.index}` : node,
        status,
        timestamp: h.createdAt,
        summary,
      }
    })
  }

  // Fallback (no history): one step from the thread detail alone.
  const interrupted = detail.status === 'interrupted' || detail.interrupts.length > 0
  let node: NodeId | 'unknown' = 'unknown'
  let status: StepStatus = 'unknown'
  if (interrupted) {
    node = 'approval'
    status = 'interrupted'
  } else if (detail.status === 'error') {
    node = 'agent'
    status = 'error'
  } else if ((detail.status === 'idle' || detail.status === 'success') && detail.messages.length > 0) {
    node = '__end__'
    status = 'completed'
  }
  return [
    {
      id: 's-0',
      index: 0,
      node,
      label: node === 'unknown' ? 'run state' : node,
      status,
      summary: 'Replay history not available from server — derived from current state.',
    },
  ]
}

/**
 * LangGraph Canvas + Run Replay — a read-only operator view of the agent_builder
 * graph WITH the real path parcouru overlaid when the server provides history.
 * Nodes/edges on the traversed path are highlighted (completed), the tip is
 * active/interrupted, and a clickable timeline + a 2-tab inspector (Node / Step)
 * expose the detail. No graph editing, no write — data from the server-only
 * routes (no secret reaches the client).
 */
export function LangGraphCanvasView({ graph, studioUrl }: { graph: string; studioUrl: string }) {
  const searchParams = useSearchParams()
  const initialThreadId = searchParams.get('threadId')

  const [threads, setThreads] = useState<ExplorerThread[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  const [selectedThread, setSelectedThread] = useState<string | null>(initialThreadId)
  const [detail, setDetail] = useState<ExplorerThreadDetail | null>(null)
  const [history, setHistory] = useState<HistoryStep[]>([])
  const [historyAvailable, setHistoryAvailable] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null)
  const [tab, setTab] = useState<'node' | 'step'>('node')

  // Live topology (from the server) + hard-coded fallback flag.
  const [topologyNodes, setTopologyNodes] = useState<TopologyNode[] | null>(null)
  const [topologyEdges, setTopologyEdges] = useState<TopologyEdge[] | null>(null)
  const [topologyLive, setTopologyLive] = useState(false)

  // Refresh state.
  const [autoRefresh, setAutoRefresh] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null)

  const loadDetail = useCallback(async (threadId: string, opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true
    setSelectedThread(threadId)
    if (!silent) {
      setDetailLoading(true)
      setDetail(null)
      setHistory([])
      setSelectedNode(null)
      setSelectedStepId(null)
    }
    setDetailError(null)
    try {
      const [dRes, hRes] = await Promise.all([
        fetch(`/api/agent-ops/langgraph/threads/${encodeURIComponent(threadId)}`),
        fetch(`/api/agent-ops/langgraph/threads/${encodeURIComponent(threadId)}/history`),
      ])
      const dData = await dRes.json().catch(() => null)
      if (!dRes.ok) {
        setDetailError(dData?.error ?? `Failed to read thread (${dRes.status}).`)
        return
      }
      setDetail(dData as ExplorerThreadDetail)
      if (hRes.ok) {
        const hData = await hRes.json().catch(() => null)
        const steps = (hData?.history as HistoryStep[]) ?? []
        setHistory(steps)
        setHistoryAvailable(steps.length > 0)
      } else {
        setHistoryAvailable(false)
      }
      // Local time-of-day stamp — Date is fine in the browser (client component).
      setLastRefreshed(new Date().toTimeString().slice(0, 8))
    } catch {
      setDetailError('LangGraph Agent Server not reachable.')
    } finally {
      if (!silent) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    let live = true
    async function load() {
      setLoading(true)
      setListError(null)
      // Topology (best-effort, non-blocking) — falls back to hard-coded on miss.
      try {
        const tRes = await fetch(`/api/agent-ops/langgraph/graphs/${encodeURIComponent(graph)}`)
        const tData = await tRes.json().catch(() => null)
        if (live && tRes.ok && tData?.topologyAvailable) {
          setTopologyNodes(tData.nodes as TopologyNode[])
          setTopologyEdges(tData.edges as TopologyEdge[])
          setTopologyLive(true)
        } else if (live) {
          setTopologyLive(false)
        }
      } catch {
        if (live) setTopologyLive(false)
      }
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
  }, [initialThreadId, loadDetail, graph])

  // Auto-refresh (light): only while a thread is running/interrupted, at most
  // every 5s, paused when the tab is hidden, cleared on unmount. Silent reloads
  // (no spinner flicker). Never polls a finished (idle/completed) run.
  const threadRunning = detail ? detail.status === 'interrupted' || detail.status === 'running' || detail.status === 'busy' : false
  useEffect(() => {
    if (!autoRefresh || !threadRunning || !selectedThread) return
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadDetail(selectedThread, { silent: true })
    }, 5000)
    return () => window.clearInterval(id)
  }, [autoRefresh, threadRunning, selectedThread, loadDetail])

  const replaySteps = useMemo(() => deriveReplaySteps(detail, history), [detail, history])

  // Nodes visited on the path (for the overlay). Derived from the replay steps.
  const visitedNodes = useMemo(() => {
    const set = new Set<NodeId>()
    for (const s of replaySteps) if (s.node !== 'unknown') set.add(s.node)
    return set
  }, [replaySteps])

  // Per-node status for the canvas: the tip node's step status wins; visited
  // nodes are 'completed'; the rest 'idle'. Never a fabricated active node.
  const nodeStatus = useMemo<Record<NodeId, StepStatus>>(() => {
    const base: Record<NodeId, StepStatus> = { __start__: 'idle', agent: 'idle', approval: 'idle', tools: 'idle', __end__: 'idle' }
    for (const n of visitedNodes) base[n] = 'completed'
    const tip = replaySteps[replaySteps.length - 1]
    if (tip && tip.node !== 'unknown' && (tip.status === 'active' || tip.status === 'interrupted' || tip.status === 'error')) {
      base[tip.node] = tip.status
    }
    return base
  }, [visitedNodes, replaySteps])

  // Edges traversed on the path (consecutive visited nodes), for the overlay.
  const traversedEdges = useMemo(() => {
    const set = new Set<string>()
    for (let i = 1; i < replaySteps.length; i += 1) {
      const from = replaySteps[i - 1].node
      const to = replaySteps[i].node
      if (from !== 'unknown' && to !== 'unknown') set.add(`${from}→${to}`)
    }
    return set
  }, [replaySteps])

  // Render nodes/edges: from the live topology when available, else fallback.
  const renderNodes = useMemo<RenderNode[]>(() => {
    const nodes = topologyLive && topologyNodes ? topologyNodes : FALLBACK_NODES.map((n) => ({ id: n.id, label: n.id, type: n.type }))
    return buildLayout(nodes)
  }, [topologyLive, topologyNodes])
  const renderEdges = useMemo<RenderEdge[]>(() => {
    if (topologyLive && topologyEdges) {
      return topologyEdges.map((e) => ({ source: e.source, target: e.target, conditional: e.conditional === true }))
    }
    return FALLBACK_EDGES
  }, [topologyLive, topologyEdges])
  const renderNodeById = useMemo(() => new Map(renderNodes.map((n) => [n.id, n])), [renderNodes])

  // Replay nodes not present in the rendered topology → shown in the timeline
  // but NOT fabricated on the canvas; surfaced via a badge.
  const unknownReplayNodes = useMemo(() => {
    const known = new Set(renderNodes.map((n) => n.id))
    const out = new Set<string>()
    for (const s of replaySteps) if (s.node !== 'unknown' && !known.has(s.node)) out.add(s.node)
    return out
  }, [replaySteps, renderNodes])

  // The node the inspector shows: explicit click wins; else the tip node.
  const activeNodeId = useMemo<NodeId | null>(() => {
    const entry = (Object.entries(nodeStatus) as [NodeId, StepStatus][]).find(([, st]) => st === 'active' || st === 'interrupted' || st === 'error')
    return entry?.[0] ?? (detail ? 'agent' : null)
  }, [nodeStatus, detail])
  const effectiveNodeId = selectedNode ?? activeNodeId
  const inspectorNode = effectiveNodeId ? renderNodeById.get(effectiveNodeId) ?? null : null
  const inspectorStep = selectedStepId ? replaySteps.find((s) => s.id === selectedStepId) ?? null : null

  function onNodeClick(id: string) {
    setSelectedNode(id)
    setTab('node')
    const stepsOnNode = replaySteps.filter((s) => s.node === id)
    setSelectedStepId(stepsOnNode.length > 0 ? stepsOnNode[stepsOnNode.length - 1].id : null)
  }
  // Node status lookup tolerant of unknown (non-replay) topology node ids.
  function statusOf(id: string): StepStatus {
    return (NODE_IDS as string[]).includes(id) ? nodeStatus[id as NodeId] : 'idle'
  }
  function onStepClick(step: ReplayStep) {
    setSelectedStepId(step.id)
    if (step.node !== 'unknown') setSelectedNode(step.node)
    setTab('step')
  }

  return (
    <div className="space-y-6">
      {/* Thread selector */}
      <AgentSectionCard title="Thread" description="Pick a run to replay on the graph.">
        {loading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <Text className="!mt-0">Loading threads…</Text>
          </div>
        ) : listError ? (
          <ErrorBanner message={listError} />
        ) : threads.length > 0 ? (
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-64">
              <Select name="thread" value={selectedThread ?? ''} onChange={(e) => loadDetail(e.target.value)} aria-label="Select a thread">
                {threads.map((t) => (
                  <option key={t.threadId} value={t.threadId}>
                    {t.threadId.slice(0, 20)}… · {t.status}
                  </option>
                ))}
              </Select>
            </div>
            <Button outline onClick={() => selectedThread && loadDetail(selectedThread, { silent: true })} disabled={!selectedThread || detailLoading}>
              Refresh thread
            </Button>
            <label className="inline-flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400">
              <Switch checked={autoRefresh} onChange={setAutoRefresh} aria-label="Auto-refresh" color="accent" />
              Auto-refresh
            </label>
            {lastRefreshed ? <span className="text-xs text-zinc-500 dark:text-zinc-400">Last refreshed at {lastRefreshed}</span> : null}
            <a href={studioUrl} target="_blank" rel="noreferrer" className="text-sm font-medium text-accent-700 hover:text-accent-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300 dark:hover:text-accent-200">
              Open in LangGraph Studio →
            </a>
            <Link href="/admin/langgraph" className="text-sm font-medium text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200">
              Back to LangGraph Runs
            </Link>
          </div>
        ) : (
          <Text>No threads on the server yet.</Text>
        )}
        {autoRefresh && !threadRunning ? (
          <Text className="mt-2 !text-xs">Auto-refresh pauses on a finished (idle/completed) run — nothing to poll.</Text>
        ) : null}
      </AgentSectionCard>

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Canvas */}
        <AgentSectionCard
          title="Graph canvas"
          description={`${graph} · ${detail ? statusLabel(detail.status) : 'select a thread'}`}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={topologyLive ? 'live' : 'fallback'}>{topologyLive ? 'Live topology' : 'Fallback topology'}</Badge>
              {unknownReplayNodes.size > 0 ? <Badge tone="warn">{`${unknownReplayNodes.size} unknown node(s) in replay`}</Badge> : null}
            </div>
          }
        >
          <div className="overflow-x-auto rounded-xl bg-gradient-to-b from-zinc-50 to-zinc-100/60 p-2 dark:from-zinc-900 dark:to-zinc-950/60">
            <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="h-auto w-full min-w-[520px]" role="img" aria-label={`${graph} graph`}>
              <CanvasDefs />
              {renderEdges.map((e, i) => {
                const a = renderNodeById.get(e.source)
                const b = renderNodeById.get(e.target)
                if (!a || !b) return null
                return <Edge key={i} a={a} b={b} dashed={e.conditional} traversed={traversedEdges.has(`${e.source}→${e.target}`)} index={i} />
              })}
              {renderNodes.map((n, i) => (
                <NodeBox key={n.id} node={n} status={statusOf(n.id)} selected={effectiveNodeId === n.id} onSelect={() => onNodeClick(n.id)} index={i} />
              ))}
            </svg>
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
            <LegendDot className="bg-zinc-700 dark:bg-zinc-300" label="completed" />
            <LegendDot className="bg-accent-500" label="active" />
            <LegendDot className="bg-accent-600" label="interrupted" />
            <LegendDot className="bg-accent-700" label="error" />
            <LegendDot className="bg-zinc-400 dark:bg-zinc-500" label="idle / unknown" />
          </div>
        </AgentSectionCard>

        {/* Inspector — 2 tabs */}
        <AgentSectionCard title="Inspector" description={tab === 'node' ? (inspectorNode?.label ?? 'node') : `step ${inspectorStep?.index ?? ''}`}>
          <div className="mb-4 flex gap-1 border-b border-zinc-950/10 dark:border-white/10">
            <TabButton active={tab === 'node'} onClick={() => setTab('node')}>Node</TabButton>
            <TabButton active={tab === 'step'} onClick={() => setTab('step')} disabled={!inspectorStep}>Step</TabButton>
          </div>

          {detailLoading ? (
            <div className="flex items-center gap-2">
              <Spinner /> <Text className="!mt-0">Reading state…</Text>
            </div>
          ) : detailError ? (
            <ErrorBanner message={detailError} />
          ) : !detail ? (
            <Text>Select a thread to inspect it.</Text>
          ) : tab === 'node' && inspectorNode ? (
            <NodeInspector node={inspectorNode} status={statusOf(inspectorNode.id)} detail={detail} graph={graph} />
          ) : tab === 'step' && inspectorStep ? (
            <StepInspector step={inspectorStep} />
          ) : (
            <Text>Click a node or a timeline step.</Text>
          )}
        </AgentSectionCard>
      </div>

      {/* Timeline */}
      <AgentSectionCard
        title="Run Replay Timeline"
        description={historyAvailable ? `${replaySteps.length} steps · click a step to inspect it` : 'Replay history not available from server — showing current state'}
      >
        {detailLoading ? (
          <div className="flex items-center gap-2">
            <Spinner /> <Text className="!mt-0">Loading replay…</Text>
          </div>
        ) : replaySteps.length > 0 ? (
          <ol className="space-y-2">
            {replaySteps.map((s) => (
              <li key={s.id}>
                <Headless.Button
                  onClick={() => onStepClick(s)}
                  className={
                    'flex w-full items-start gap-3 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ' +
                    (selectedStepId === s.id ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent-line)]' : 'hover:bg-zinc-950/5 dark:hover:bg-white/5')
                  }
                >
                  <span className="mt-0.5 w-6 shrink-0 text-right font-mono text-xs text-zinc-400">{s.index}</span>
                  <StatusDot status={s.status} />
                  <span className="min-w-0 flex-1">
                    <span className="font-mono text-sm text-zinc-950 dark:text-white">{s.label}</span>
                    <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-400">{statusLabel(s.status)}</span>
                    {s.summary ? <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">{s.summary}</span> : null}
                  </span>
                  {s.timestamp ? <span className="shrink-0 font-mono text-xs text-zinc-400">{s.timestamp.slice(11, 19)}</span> : null}
                </Headless.Button>
              </li>
            ))}
          </ol>
        ) : (
          <Text>Select a thread to see its replay.</Text>
        )}
      </AgentSectionCard>
    </div>
  )
}

// --- Inspector panels ------------------------------------------------------

function NodeInspector({ node, status, detail, graph }: { node: RenderNode; status: StepStatus; detail: ExplorerThreadDetail; graph: string }) {
  const toolCalls = detail.messages.flatMap((m) => m.toolCalls ?? [])
  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Node</p>
        <p className="font-mono text-zinc-950 dark:text-white">{node.label}</p>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">{node.role}</p>
      </div>
      <dl className="grid grid-cols-1 gap-y-2">
        <Row label="Node status" value={statusLabel(status)} />
        <Row label="Thread status" value={statusLabel(detail.status)} />
        <Row label="Current node" value={detail.currentNode ?? 'not available'} mono />
        <Row label="Thread id" value={detail.threadId} mono />
        <Row label="Graph" value={detail.graph ?? graph} mono />
        <Row label="Assistant id" value={detail.assistantId ?? 'not available'} mono />
      </dl>
      {node.id === 'approval' && detail.interrupts.length > 0 ? (
        <div className="rounded-lg bg-[var(--accent-soft)] p-3 ring-1 ring-[var(--accent-line)]">
          <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">Awaiting human approval</p>
          <pre className="mt-2 overflow-x-auto text-xs whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{redactedJson(detail.interrupts)}</pre>
        </div>
      ) : null}
      {node.id === 'tools' ? (
        toolCalls.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tool calls</p>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {toolCalls.map((c, i) => (
                <li key={i} className="rounded-md bg-zinc-950/5 px-2 py-1 font-mono text-xs dark:bg-white/5">{c}</li>
              ))}
            </ul>
          </div>
        ) : (
          <Text className="!text-xs">No tool calls recorded on this thread.</Text>
        )
      ) : null}
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
  )
}

function StepInspector({ step }: { step: ReplayStep }) {
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-1 gap-y-2">
        <Row label="Index" value={String(step.index)} mono />
        <Row label="Node" value={step.node} mono />
        <Row label="Status" value={statusLabel(step.status)} />
        <Row label="Timestamp" value={step.timestamp ?? 'not available'} mono />
      </dl>
      {step.summary ? (
        <div>
          <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Summary</p>
          <p className="mt-0.5 whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{step.summary}</p>
        </div>
      ) : null}
      <div>
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Step (redacted)</p>
        <pre className="mt-1.5 overflow-x-auto rounded-lg bg-zinc-950/5 p-3 text-xs whitespace-pre-wrap text-zinc-700 dark:bg-white/5 dark:text-zinc-300">
          {redactedJson({ index: step.index, node: step.node, status: step.status, timestamp: step.timestamp, summary: step.summary })}
        </pre>
      </div>
    </div>
  )
}

// --- SVG pieces ------------------------------------------------------------

/**
 * Shared SVG defs + scoped animations. Gradients per state, a soft drop shadow,
 * an accent glow for the live node, and keyframes: a gentle pulse on the
 * active/interrupted node, a flowing dash on traversed edges, and a spring
 * fade-in on mount. All motion is disabled under prefers-reduced-motion.
 */
function CanvasDefs() {
  return (
    <>
      <defs>
        {/* Node surface gradients — subtle top-lit sheen, never flat. */}
        <linearGradient id="node-idle" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(113,113,122,0.08)" />
          <stop offset="100%" stopColor="rgba(113,113,122,0.02)" />
        </linearGradient>
        <linearGradient id="node-completed" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(113,113,122,0.14)" />
          <stop offset="100%" stopColor="rgba(113,113,122,0.05)" />
        </linearGradient>
        <linearGradient id="node-hot" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-soft)" />
          <stop offset="100%" stopColor="var(--accent-surface)" />
        </linearGradient>
        {/* Soft drop shadow for elevation. */}
        <filter id="node-shadow" x="-30%" y="-30%" width="160%" height="180%">
          <feDropShadow dx="0" dy="1.5" stdDeviation="2" floodColor="rgb(24 24 27)" floodOpacity="0.12" />
        </filter>
        <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="rgb(161 161 170)" />
        </marker>
        <marker id="arrow-hot" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent-line)" />
        </marker>
      </defs>
      <style>{`
        /* Fade-in ONLY on opacity — the group's transform carries the node's
           position, so animating transform here would stack every node at the
           origin. */
        .lg-node { opacity: 0; animation: lg-in 340ms ease-out forwards; }
        .lg-node rect { transition: stroke-width 180ms ease, filter 200ms ease; }
        .lg-node:hover rect.lg-surface { filter: url(#node-shadow) brightness(1.03); }
        .lg-flow { stroke-dasharray: 5 7; animation: lg-dash 1.1s linear infinite; }
        @keyframes lg-in { to { opacity: 1; } }
        @keyframes lg-dash { to { stroke-dashoffset: -24; } }
        @media (prefers-reduced-motion: reduce) {
          .lg-node { opacity: 1; animation: none; }
          .lg-flow { animation: none; }
        }
      `}</style>
    </>
  )
}

function NodeBox({ node, status, selected, onSelect, index }: { node: RenderNode; status: StepStatus; selected: boolean; onSelect: () => void; index: number }) {
  const hot = status === 'interrupted' || status === 'active'
  const fillId =
    hot ? 'url(#node-hot)' : status === 'completed' ? 'url(#node-completed)' : 'url(#node-idle)'
  const stroke =
    status === 'interrupted' || status === 'active'
      ? 'var(--accent-line)'
      : status === 'error'
        ? 'var(--color-accent-800)'
        : status === 'completed'
          ? 'rgb(113 113 122)'
          : 'rgb(212 212 216)'
  return (
    <g
      className="lg-node cursor-pointer focus:outline-none"
      style={{ animationDelay: `${index * 55}ms` }}
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
      aria-label={`${node.label} — ${status}`}
    >
      {/* Base card (white so the gradient reads on any bg) + gradient surface. */}
      <rect width={NODE_W} height={NODE_H} rx={9} className="fill-white dark:fill-zinc-900" filter="url(#node-shadow)" />
      <rect className="lg-surface" width={NODE_W} height={NODE_H} rx={9} fill={fillId} stroke={stroke} strokeWidth={selected ? 2 : 1.25} />
      <text x={NODE_W / 2} y={NODE_H / 2 - 2} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-950 font-mono text-[10px] font-medium dark:fill-white">
        {node.label}
      </text>
      <text x={NODE_W / 2} y={NODE_H / 2 + 9} textAnchor="middle" dominantBaseline="middle" className="fill-zinc-500 text-[6.5px] font-semibold tracking-wider uppercase dark:fill-zinc-400">
        {status}
      </text>
    </g>
  )
}

function Edge({ a, b, dashed, traversed, index }: { a: RenderNode; b: RenderNode; dashed: boolean; traversed: boolean; index: number }) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const x1 = a.x + ux * (NODE_H / 2 + 3)
  const y1 = a.y + uy * (NODE_H / 2 + 3)
  const x2 = b.x - ux * (NODE_H / 2 + 8)
  const y2 = b.y - uy * (NODE_H / 2 + 8)
  // Gentle curve: bow the line perpendicular to its direction so parallel edges
  // (agent↔approval, agent↔tools) don't overlap and it reads softer.
  const mx = (x1 + x2) / 2 + -uy * 14
  const my = (y1 + y2) / 2 + ux * 14
  const d = `M ${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`
  const stroke = traversed ? 'var(--accent-line)' : 'rgb(212 212 216)'
  return (
    <g className="lg-node" style={{ animationDelay: `${index * 40}ms` }}>
      {/* Base edge. */}
      <path d={d} fill="none" stroke={stroke} strokeWidth={traversed ? 2 : 1.25} strokeDasharray={dashed && !traversed ? '4 4' : undefined} markerEnd={traversed ? 'url(#arrow-hot)' : 'url(#arrow)'} strokeLinecap="round" />
      {/* Animated flow overlay on traversed edges. */}
      {traversed ? <path className="lg-flow" d={d} fill="none" stroke="var(--accent-line)" strokeWidth={2} strokeLinecap="round" opacity={0.7} /> : null}
    </g>
  )
}

function StatusDot({ status }: { status: StepStatus }) {
  const c =
    status === 'interrupted' ? 'bg-accent-600' : status === 'active' ? 'bg-accent-500' : status === 'error' ? 'bg-accent-700' : status === 'completed' ? 'bg-zinc-700 dark:bg-zinc-300' : 'bg-zinc-400 dark:bg-zinc-500'
  return <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${c}`} />
}

function Badge({ tone, children }: { tone: 'live' | 'fallback' | 'warn'; children: React.ReactNode }) {
  const cls =
    tone === 'live'
      ? 'bg-[var(--accent-soft)] text-accent-700 ring-[var(--accent-line)] dark:text-accent-300'
      : tone === 'warn'
        ? 'bg-accent-500/10 text-accent-700 ring-accent-500/30 dark:text-accent-300'
        : 'bg-zinc-950/5 text-zinc-600 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10'
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ${cls}`}>{children}</span>
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={`size-2 rounded-full ${className}`} />
      {label}
    </span>
  )
}

function TabButton({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Headless.Button
      onClick={onClick}
      disabled={disabled}
      className={
        'border-b-2 px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 ' +
        (disabled
          ? 'cursor-not-allowed border-transparent text-zinc-300 dark:text-zinc-600'
          : active
            ? 'border-accent-500 text-zinc-950 dark:text-white'
            : 'border-transparent text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200')
      }
    >
      {children}
    </Headless.Button>
  )
}

function statusLabel(s: string): string {
  const t = s.replace(/[-_]/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Keys whose VALUES must never be rendered (defense in depth — the routes
// already redact, but the inspector never shows a suspect key's value).
const SECRET_KEY_RE = /(secret|token|api[_-]?key|password|authorization|x-agent-key|service[_-]?role)/i
function redactedJson(value: unknown): string {
  const seen = new WeakSet()
  function walk(v: unknown): unknown {
    if (v === null || typeof v !== 'object') return v
    if (seen.has(v as object)) return '[circular]'
    seen.add(v as object)
    if (Array.isArray(v)) return v.map(walk)
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY_RE.test(k) ? '[redacted]' : walk(val)
    }
    return out
  }
  try {
    return JSON.stringify(walk(value), null, 2)
  } catch {
    return '[unserializable]'
  }
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">{label}</dt>
      <dd className={'mt-0.5 text-zinc-950 dark:text-white' + (mono ? ' font-mono text-xs break-all' : '')}>{value}</dd>
    </div>
  )
}
