'use client'

import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { Spinner } from '@/components/agent-ops/authoring-primitives'
import {
  FALLBACK_EDGES,
  GraphCanvasSvg,
  NODE_IDS,
  type NodeId,
  type StepStatus,
} from '@/components/agent-ops/graph-canvas-svg'
import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { TestCaseTable, type LiveCaseState } from '@/components/agent-ops/test-case-table'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import { consumeSSE } from '@/lib/agent-mission-control/sse-client'
import type { TestRunEvent } from '@/lib/agent-mission-control/test-runner'
import type { TestCase, TestResult, TestResultStatus, TestRun } from '@/lib/agent-mission-control/types'

interface LiveTestRunPanelProps {
  copilotId: string
  /** The suite to run. When omitted the trigger is disabled with a zinc hint. */
  suiteId?: string
  /** Optional explicit version; defaults server-side to production→latest. */
  versionId?: string
  /**
   * The cases of the suite being run — rendered as the SINGLE cases table below
   * the canvas. It resets on `run-started` and fills in running→pass/fail live;
   * outside a run it shows the persisted `resultsByCase`. Owned here (not in the
   * server section) so the table reflects the live stream state directly.
   */
  cases: TestCase[]
  /** Persisted results of the suite's last run — the table's out-of-run state. */
  resultsByCase: Record<string, TestResult | undefined>
}

/** The SSE frames the stream route emits: the runner's own events + terminals. */
type StreamFrame = TestRunEvent | { type: 'done'; testRun: TestRun } | { type: 'error'; error?: string }

/**
 * Live per-case verdict. `running` is a client-only pending state (no server
 * event carries it); the two non-terminal `TestResultStatus` values
 * (`skip`/`running`) collapse onto `error` so a row never sticks on a spinner.
 */
type CaseStatus = 'running' | 'pass' | 'fail' | 'error'
interface LiveCase {
  caseId: string
  name: string
  index: number
  total: number
  status: CaseStatus
  /** Carried by `case-completed`; feeds the table's Failure column live. */
  failureReason: string | null
}

function toCaseStatus(status: TestResultStatus): CaseStatus {
  return status === 'pass' || status === 'fail' || status === 'error' ? status : 'error'
}

/**
 * Result semantics carried by the LABEL + accent-intensity — never a green/red
 * hue (doctrine: one chromatic teinte, accent). Mirrors `test-case-table.tsx`:
 * pass = soft accent, fail = solid accent, error = mid accent, running = zinc
 * spinner.
 */
const caseIconClass: Record<CaseStatus, string> = {
  pass: 'text-accent-400',
  fail: 'text-accent-600',
  error: 'text-accent-500',
  running: 'text-zinc-400 animate-spin',
}

function CaseIcon({ status }: { status: CaseStatus }) {
  const className = clsx('size-4 shrink-0', caseIconClass[status])
  switch (status) {
    case 'pass':
      return <CheckCircleIcon aria-hidden="true" className={className} />
    case 'fail':
      return <XCircleIcon aria-hidden="true" className={className} />
    case 'error':
      return <ExclamationTriangleIcon aria-hidden="true" className={className} />
    case 'running':
    default:
      return <ArrowPathIcon aria-hidden="true" className={className} />
  }
}

/** All graph nodes reset to idle. Each case starts from a clean canvas. */
function idleNodeStatus(): Record<NodeId, StepStatus> {
  return { __start__: 'idle', agent: 'idle', approval: 'idle', tools: 'idle', __end__: 'idle' }
}

/** Edge key convention the canvas expects: `${source}→${target}` (U+2192). */
const EDGE_KEY = (from: string, to: string) => `${from}→${to}`

/** True when `from → to` is a real edge in the agent_builder topology. */
function isKnownEdge(from: string, to: string): boolean {
  return FALLBACK_EDGES.some((e) => e.source === from && e.target === to)
}

/** Is `node` one of the known agent_builder ids (vs a novel topology node)? */
function isKnownNode(node: string): node is NodeId {
  return (NODE_IDS as string[]).includes(node)
}

/**
 * Live "Run tests" panel — drives a real suite run over SSE and animates the
 * agent_builder graph as each case executes.
 *
 * Layout is 2/3 canvas + 1/3 live detail. The canvas is the SAME pure
 * `GraphCanvasSvg` the read-only explorer uses; this panel owns the derived
 * `nodeStatus`/`traversedEdges` state and RESETS it on every `case-started`
 * (each case is its own graph thread — leaving node N lit onto case N+1 would
 * lie). `__start__`/`__end__` are synthesized client-side (the stream never
 * emits them); a case that pauses on `approval` (HITL interrupt) is a CORRECT
 * outcome, shown as `approval` interrupted with no `__end__`, and can still be a
 * pass. Monochrome accent; the fail indicator is accent-600, never a second hue.
 *
 * It also owns the SINGLE cases table below the canvas: `run-started` resets it,
 * each `case-started`/`case-completed` fills a row running→pass/fail LIVE, and
 * the post-run `router.refresh()` drops it back to the persisted results
 * (identical verdicts). `TestsSection` renders no separate table for this suite.
 */
export function LiveTestRunPanel({ copilotId, suiteId, versionId, cases: suiteCases, resultsByCase }: LiveTestRunPanelProps) {
  const router = useRouter()
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ status: string; passRate: number } | null>(null)

  // Per-case list (built as `case-started` frames arrive) + live verdicts.
  const [cases, setCases] = useState<LiveCase[]>([])
  const [currentCaseId, setCurrentCaseId] = useState<string | null>(null)

  // Whether the cases table below is driven by the LIVE stream (true from the
  // Run click until the post-run `router.refresh()` lands) or falls back to the
  // persisted `resultsByCase`. When true the table resets + fills live; when
  // false it shows the last persisted run. Kept SEPARATE from `isRunning` so the
  // reset is visible the instant Run is pressed, before the first frame.
  const [isLive, setIsLive] = useState(false)

  // Live canvas state for the CURRENT case only (reset each case-started).
  const [nodeStatus, setNodeStatus] = useState<Record<NodeId, StepStatus>>(idleNodeStatus)
  const [traversedEdges, setTraversedEdges] = useState<Set<string>>(() => new Set())
  const [currentNode, setCurrentNode] = useState<string | null>(null)

  // The last KNOWN node the current case entered — used to (a) mark it
  // 'completed' when the next node arrives and (b) decide, on completion,
  // whether the case paused on approval (interrupted, no __end__) or finished
  // (synthesize __end__). A ref so the SSE handler always reads the latest value
  // without re-subscribing.
  const lastNodeRef = useRef<NodeId | null>(null)

  // Set true right before `router.refresh()`; the effect below swaps the table
  // from the live map back to the freshly-persisted `resultsByCase` the moment
  // those new props arrive (same verdicts + now-populated latency/cost), so the
  // live→server handoff shows no flash of stale data.
  const pendingRefreshRef = useRef(false)

  const currentCase = cases.find((c) => c.caseId === currentCaseId) ?? null

  // When a run's refreshed server props land, leave the live phase — the table
  // now reads the persisted results (identical to what the stream showed).
  useEffect(() => {
    if (pendingRefreshRef.current) {
      pendingRefreshRef.current = false
      setIsLive(false)
    }
  }, [resultsByCase])

  const onFrame = useCallback((frame: StreamFrame) => {
    switch (frame.type) {
      case 'run-started':
        // Confirm the live phase (already set in handleRun) and RESET everything
        // — the table's Result column blanks for every case here.
        setIsLive(true)
        setCases([])
        setCurrentCaseId(null)
        setNodeStatus(idleNodeStatus())
        setTraversedEdges(new Set())
        setCurrentNode(null)
        lastNodeRef.current = null
        break

      case 'case-started': {
        // A fresh graph thread — RESET the canvas so case N-1's lit nodes don't
        // bleed onto this one. Synthesize __start__ as completed (the stream
        // never emits it — the run always begins there).
        const fresh = idleNodeStatus()
        fresh.__start__ = 'completed'
        setNodeStatus(fresh)
        setTraversedEdges(new Set())
        setCurrentNode(null)
        setCurrentCaseId(frame.caseId)
        lastNodeRef.current = '__start__'
        setCases((prev) => {
          if (prev.some((c) => c.caseId === frame.caseId)) return prev
          return [
            ...prev,
            {
              caseId: frame.caseId,
              name: frame.name,
              index: frame.index,
              total: frame.total,
              status: 'running',
              failureReason: null,
            },
          ]
        })
        break
      }

      case 'case-node': {
        const node = frame.node
        setCurrentNode(node)
        // Advance the canvas: previous known node → completed, this node →
        // active, and highlight the edge between them when it's a real one.
        setNodeStatus((prev) => {
          const next = { ...prev }
          const from = lastNodeRef.current
          if (from && from !== node && isKnownNode(from)) {
            // A normal traversal marks the node we're leaving as completed;
            // never demote an interrupted/error tip.
            if (next[from] === 'active' || next[from] === 'completed' || next[from] === 'idle') {
              next[from] = 'completed'
            }
          }
          if (isKnownNode(node)) next[node] = 'active'
          return next
        })
        setTraversedEdges((prev) => {
          const from = lastNodeRef.current
          if (from && from !== node && isKnownNode(from) && isKnownNode(node) && isKnownEdge(from, node)) {
            const set = new Set(prev)
            set.add(EDGE_KEY(from, node))
            return set
          }
          return prev
        })
        if (isKnownNode(node)) lastNodeRef.current = node
        break
      }

      case 'case-completed': {
        const verdict = toCaseStatus(frame.status)
        const last = lastNodeRef.current
        // A case whose last node was `approval` PAUSED there for human
        // confirmation (HITL interrupt) — that is a correct terminal state, not
        // an error. Show approval interrupted and DON'T synthesize __end__. The
        // verdict can still be a pass (the expectation WAS the pause).
        const pausedOnApproval = last === 'approval'
        setNodeStatus((prev) => {
          const next = { ...prev }
          if (pausedOnApproval) {
            next.approval = 'interrupted'
          } else {
            // Normal completion: the tip node is done and the run reached the
            // (un-emitted) terminal node.
            if (last && isKnownNode(last) && next[last] === 'active') next[last] = 'completed'
            next.__end__ = 'completed'
          }
          return next
        })
        if (!pausedOnApproval) {
          setTraversedEdges((prev) => {
            const from = last
            if (from && isKnownNode(from) && isKnownEdge(from, '__end__')) {
              const set = new Set(prev)
              set.add(EDGE_KEY(from, '__end__'))
              return set
            }
            return prev
          })
        }
        setCurrentNode(pausedOnApproval ? 'approval' : null)
        setCases((prev) =>
          prev.map((c) =>
            c.caseId === frame.caseId ? { ...c, status: verdict, failureReason: frame.failureReason } : c
          )
        )
        break
      }

      case 'run-finished':
        setResult({ status: frame.status, passRate: frame.passRate })
        break

      case 'done':
        setResult({ status: frame.testRun.status, passRate: frame.testRun.passRate })
        break

      case 'error':
        setError(frame.error ? `Test run failed — ${frame.error}` : 'Test run failed — a case aborted the run.')
        break

      // case-thread: threadId is not needed for the canvas; ignore it.
      default:
        break
    }
  }, [])

  async function handleRun() {
    if (isRunning || !suiteId) return

    setIsRunning(true)
    // Enter the live phase NOW — the table's Result column blanks the instant
    // Run is pressed, before the first SSE frame lands.
    setIsLive(true)
    setError(null)
    setResult(null)
    setCases([])
    setCurrentCaseId(null)
    setNodeStatus(idleNodeStatus())
    setTraversedEdges(new Set())
    setCurrentNode(null)
    lastNodeRef.current = null

    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/tests/run/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ suiteId, versionId }),
      })

      if (!response.ok || !response.body) {
        setError(`Test run failed (${response.status}).`)
        return
      }

      await consumeSSE<StreamFrame>(response.body, onFrame)
      // The persisted run tables re-read once the stream closes. Arm the effect
      // to leave the live phase as soon as the refreshed props land, so the
      // table swaps from the live map to the persisted results without a flash.
      pendingRefreshRef.current = true
      router.refresh()
    } catch {
      setError('Test run failed — the backend is unreachable.')
    } finally {
      setIsRunning(false)
      // If we never armed a refresh (early return / thrown before stream end),
      // leave the live phase now so the table falls back to server results
      // instead of staying stuck on a blank live map.
      if (!pendingRefreshRef.current) setIsLive(false)
    }
  }

  const currentNodeLabel = describeNode(currentNode)

  // The live override the cases table consumes during a run: one entry per case
  // that has started, carrying its running/pass/fail verdict + failure reason.
  // Passed to the table ONLY while `isLive` (else the table shows persisted
  // results). A reset (empty `cases`) yields `{}`, which blanks every Result
  // cell — exactly the "reset on launch" behaviour.
  const liveByCase: Record<string, LiveCaseState> | undefined = isLive
    ? Object.fromEntries(cases.map((c) => [c.caseId, { status: c.status, failureReason: c.failureReason }]))
    : undefined

  return (
    <div className="flex flex-col gap-4">
      <AgentSectionCard
        title="Live run"
        description="Run the suite and watch the agent_builder graph execute case by case."
        actions={
          <div className="flex items-center gap-3">
            {result ? (
              <Badge color="accent">
                {result.status === 'completed'
                  ? `${Math.round(result.passRate * 100)}% passed`
                  : 'Run aborted'}
              </Badge>
            ) : null}
            <Button
              color="accent"
              onClick={handleRun}
              disabled={isRunning || !suiteId}
              title={suiteId ? undefined : 'No suite to run'}
            >
              {isRunning ? (
                <>
                  <Spinner />
                  Running…
                </>
              ) : (
                'Run tests'
              )}
            </Button>
          </div>
        }
      >
        <div className="grid gap-6 lg:grid-cols-3">
          {/* CANVAS — 2/3. Reused pure SVG, driven by this panel's live state. */}
          <div className="lg:col-span-2">
            <GraphCanvasSvg
              nodeStatus={nodeStatus}
              traversedEdges={traversedEdges}
              ariaLabel="Live test run — agent_builder graph"
            />
          </div>

          {/* LIVE DETAIL — 1/3. Current case, current node, per-case verdicts. */}
          <div className="flex flex-col gap-4 lg:col-span-1">
            <div className="rounded-xl border border-white/5 bg-black/20 px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Current case</p>
              {currentCase ? (
                <>
                  <p className="mt-1 truncate text-sm font-medium text-white" title={currentCase.name}>
                    {currentCase.name}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-zinc-500 tabular-nums">
                    Case {currentCase.index}/{currentCase.total}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-sm text-zinc-500">
                  {isRunning ? 'Starting…' : 'Idle — press Run tests.'}
                </p>
              )}
              <div className="mt-3 border-t border-white/5 pt-3">
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Current node</p>
                <p className="mt-1 font-mono text-sm text-accent-400">{currentNodeLabel}</p>
              </div>
            </div>

            <div>
              <p className="mb-2 text-xs font-medium tracking-wide text-zinc-500 uppercase">
                Cases {cases.length > 0 ? `(${cases.length})` : ''}
              </p>
              {cases.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {cases.map((c) => (
                    <li
                      key={c.caseId}
                      className={clsx(
                        'flex items-center gap-2 rounded-lg px-2 py-1.5',
                        c.caseId === currentCaseId ? 'bg-[var(--accent-soft)] ring-1 ring-[var(--accent-line)]' : ''
                      )}
                    >
                      <CaseIcon status={c.status} />
                      <span className="truncate text-xs text-zinc-300" title={c.name}>
                        {c.name}
                      </span>
                      <span className="ml-auto font-mono text-xs text-zinc-600 tabular-nums">
                        {c.index}/{c.total}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <Text className="!mt-0 !text-xs">No cases yet — the run will list them here as it starts.</Text>
              )}
            </div>

            {error ? <Text className="!mt-0 !text-xs !text-accent-400">{error}</Text> : null}
          </div>
        </div>
      </AgentSectionCard>

      {/* THE single cases table for this suite. Server-driven at rest; while a
          run streams (`isLive`) it resets and fills running→pass/fail live via
          `liveByCase`. `TestsSection` renders NO separate table for this suite —
          this is the only one on screen. */}
      <TestCaseTable cases={suiteCases} resultsByCase={resultsByCase} liveByCase={liveByCase} />
    </div>
  )
}

/** Human-friendly label for the node currently executing. */
function describeNode(node: string | null): string {
  if (!node) return '—'
  switch (node) {
    case '__start__':
      return 'start'
    case '__end__':
      return 'end'
    case 'agent':
      return 'agent'
    case 'approval':
      return 'approval — waiting confirmation'
    case 'tools':
      return 'tools'
    default:
      return node
  }
}
