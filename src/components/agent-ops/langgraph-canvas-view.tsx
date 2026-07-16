'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import * as Headless from '@headlessui/react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import {
  GraphCanvasSvg,
  buildLayout,
  FALLBACK_EDGES,
  FALLBACK_NODES,
  NODE_IDS,
  type NodeId,
  type RenderEdge,
  type RenderNode,
  type StepStatus,
  type TopologyEdge,
  type TopologyNode,
} from '@/components/agent-ops/graph-canvas-svg'
import { Badge } from '@/components/catalyst/badge'
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

// --- agent_builder topology + SVG canvas -------------------------------------
// The topology (node ids, fixed positions, hard-coded fallback), the layout, the
// status/step types AND the low-level SVG rendering all live in the PURE
// presentational module `./graph-canvas-svg` — reusable by any consumer that can
// hand it a `nodeStatus` / `traversedEdges` (e.g. a live test panel). This view
// keeps ONLY the data layer: it derives that state from the run history and
// delegates the rendering. Imported symbols: NODE_IDS, buildLayout,
// FALLBACK_NODES, FALLBACK_EDGES, GraphCanvasSvg + the types.

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
  const [manualRefreshing, setManualRefreshing] = useState(false)

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
  // `canvasNodes` is the raw topology (pre-layout) handed to the pure canvas,
  // which runs `buildLayout` itself; `renderNodes` is the laid-out copy this
  // view needs locally (inspector lookup, unknown-node detection).
  const canvasNodes = useMemo<TopologyNode[]>(
    () => (topologyLive && topologyNodes ? topologyNodes : FALLBACK_NODES.map((n) => ({ id: n.id, label: n.id, type: n.type }))),
    [topologyLive, topologyNodes],
  )
  const renderNodes = useMemo<RenderNode[]>(() => buildLayout(canvasNodes), [canvasNodes])
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
            <Button
              outline
              onClick={async () => {
                if (!selectedThread) return
                setManualRefreshing(true)
                try {
                  await loadDetail(selectedThread, { silent: true })
                } finally {
                  setManualRefreshing(false)
                }
              }}
              disabled={!selectedThread || detailLoading || manualRefreshing}
            >
              {manualRefreshing ? (
                <>
                  <Spinner className="size-4 animate-spin" /> Refreshing…
                </>
              ) : (
                'Refresh thread'
              )}
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
              <Badge color={topologyLive ? 'accent' : 'zinc'}>{topologyLive ? 'Live topology' : 'Fallback topology'}</Badge>
              {unknownReplayNodes.size > 0 ? <Badge color="accentStrong">{`${unknownReplayNodes.size} unknown node(s) in replay`}</Badge> : null}
            </div>
          }
        >
          <GraphCanvasSvg
            nodeStatus={nodeStatus}
            traversedEdges={traversedEdges}
            onNodeClick={onNodeClick}
            selectedNodeId={effectiveNodeId}
            nodes={canvasNodes}
            edges={renderEdges}
            ariaLabel={`${graph} graph`}
          />
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
                    'flex w-full min-h-11 items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 sm:py-1.5 ' +
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

// --- Timeline / badges (view-local) ----------------------------------------

function StatusDot({ status }: { status: StepStatus }) {
  const c =
    status === 'interrupted' ? 'bg-accent-600' : status === 'active' ? 'bg-accent-500' : status === 'error' ? 'bg-accent-700' : status === 'completed' ? 'bg-zinc-700 dark:bg-zinc-300' : 'bg-zinc-400 dark:bg-zinc-500'
  return <span aria-hidden="true" className={`mt-1.5 size-2 shrink-0 rounded-full ${c}`} />
}

function TabButton({ active, onClick, disabled, children }: { active: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Headless.Button
      onClick={onClick}
      disabled={disabled}
      className={
        'min-h-11 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 sm:min-h-0 sm:py-1.5 ' +
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
