'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Button } from '@/components/catalyst/button'
import { Text } from '@/components/catalyst/text'
import type { Capability, LifecycleActionId } from '@/lib/agent-mission-control/agent-lifecycle'
import type {
  AutoImproveEvent,
  AutoImprovementResult,
  ImprovementManifestChanges,
  ImprovementProposal,
  VersionComparison,
} from '@/lib/agent-mission-control/improvement-loop'
import { consumeSSE } from '@/lib/agent-mission-control/sse-client'
import type { TestRunEvent } from '@/lib/agent-mission-control/test-runner'
import type { TestRun } from '@/lib/agent-mission-control/types'

/**
 * Evolution workbench — the client half of `/admin/agents/[id]/evolution`
 * (AIGENT-OPERATOR-RESTORE-028).
 *
 * This is a DRIVER, not an engine. Every button posts to a route that already
 * exists (`tests/generate`, `tests/run/stream`, `benchmarks/run`,
 * `improve/auto`, `improve/analyze`, `improve/create-v2`, `improve/decision`);
 * nothing here recomputes a pass rate, a gate verdict or a capability. The
 * server decided what may run (`getAgentLifecycle`), the routes re-enforce it,
 * and this component's only job is to make that decision VISIBLE before the
 * click.
 *
 * The rule the surface exists to enforce: a disabled control always renders its
 * reason, and a `degraded` control renders what it will NOT prove — while
 * staying clickable. The predecessor (`improve-workbench.tsx`, deleted at
 * eff7b22) offered "Run tests" on every agent regardless of its actual
 * runtime, and could silently execute a suite on an engine that is not this
 * agent's own, reporting that engine's pass rate as the agent's. A button
 * that lies is worse than a button that is missing — so here availability is
 * always derived from THIS copilot's own runtime (`langgraph` or
 * `openai-assistants`, whichever it actually is), never assumed, and a
 * disabled state carries the sentence that explains it.
 */

export interface EvolutionSuiteRef {
  id: string
  name: string
}

export interface EvolutionWorkbenchProps {
  copilotId: string
  capabilities: Record<LifecycleActionId, Capability>
  /** Test suites available to run. Empty ⇒ `run-tests` is already unavailable server-side. */
  testSuites: EvolutionSuiteRef[]
  /** Benchmark suites available to run. Empty ⇒ nothing to benchmark. */
  benchmarkSuites: EvolutionSuiteRef[]
  latestProposal: ImprovementProposal | null
  /** V1 vs V2, recomputed server-side by `compareImprovementVersions`. Null when no V2 exists. */
  comparison: VersionComparison | null
  /** Label of the version a re-run pins to (the V2), for the operator to read before clicking. */
  candidateLabel: string | null
}

/** The SSE frames `improve/auto` emits. */
type AutoFrame = AutoImproveEvent | ({ type: 'done' } & AutoImprovementResult) | { type: 'error'; error: string }

/** The SSE frames `tests/run/stream` emits. */
type TestFrame = TestRunEvent | { type: 'done'; testRun: TestRun } | { type: 'error'; error?: string }

/** One live line of an auto-improve cycle. */
interface AutoLine {
  key: string
  step: string
  detail: string | null
  iteration: number
}

/** One live line of a streaming test run. */
interface TestLine {
  key: string
  label: string
  detail: string | null
}

/**
 * Human wording for each auto-improve milestone. The event `type` is an enum
 * value, never text for a human — spelling it here keeps the loop's vocabulary
 * out of the pixels.
 */
const AUTO_STEP_LABELS: Record<AutoImproveEvent['type'], string> = {
  'iteration-start': 'Iteration started',
  analyzed: 'Signals analysed, proposal written',
  'v2-created': 'V2 draft created',
  reran: 'V2 re-run compared to V1',
  converged: 'Converged — every suite passes',
  plateau: 'Plateau — no further gain',
  exhausted: 'Budget or iteration ceiling reached',
  error: 'Cycle error',
}

/** Why the cycle stopped, in the operator's words. */
const STOPPED_BY_LABELS: Record<AutoImprovementResult['stoppedBy'], string> = {
  converged: 'Converged — every test suite reached a full pass rate.',
  plateau: 'Plateau — an iteration produced no measurable gain.',
  'max-iterations': 'Iteration ceiling reached before convergence.',
  budget: 'Cost budget reached before convergence.',
  'nothing-to-improve': 'No improvement signal: no failing case and no sub-target benchmark.',
  blocked: 'Blocked — the loop could not proceed.',
}

/** Manifest fields the proposer may change, in the order the diff reads best. */
const MANIFEST_FIELD_LABELS: Record<keyof ImprovementManifestChanges, string> = {
  systemPromptSummary: 'Behaviour charter',
  forbiddenActions: 'Forbidden actions',
  alwaysConfirmActions: 'Always-confirm actions',
  confirmationPolicy: 'Confirmation policy',
  maxStepsPerRun: 'Max steps per run',
  outputContractInvariants: 'Output contract invariants',
}

const PROPOSAL_STATUS_LABELS: Record<ImprovementProposal['status'], string> = {
  proposed: 'Proposed',
  'v2-created': 'V2 created',
  approved: 'Approved',
  rejected: 'Rejected',
}

/** A pass rate is a measurement: absent stays absent, never 0%. */
function formatRate(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '—'
}

function formatScore(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(1) : '—'
}

/** Render a manifest value of any allowed shape without inventing structure. */
function formatManifestValue(value: string | string[] | number): string {
  if (Array.isArray(value)) return value.length === 0 ? '(empty list)' : value.join(' · ')
  return String(value)
}

/**
 * The affordance contract, in one place: a control renders its capability
 * BEFORE it is clicked.
 *
 * `unavailable` → disabled + reason + technical detail, in zinc-300/400 (never
 * zinc-500, which fails AA on these planes). `degraded` → enabled, but the
 * shortfall is stated above the button, so the operator knows what the result
 * will not prove.
 */
function CapabilityNote({ capability }: { capability: Capability }) {
  if (capability.state === 'available') return null
  return (
    <div className="mt-2 text-xs leading-5">
      <p className="text-zinc-300">
        {capability.state === 'degraded' ? 'Runs, but does not prove: ' : 'Unavailable: '}
        <span className="text-zinc-400">{capability.reason}</span>
      </p>
      <p className="mt-1 text-zinc-400">{capability.detail}</p>
    </div>
  )
}

/** Section shell — plane 2 on the plane-1 page. No card inside a card. */
function Block({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl bg-white/[0.02] p-4 ring-1 ring-inset ring-white/10 sm:p-5">
      <p className={eyebrowClass}>{title}</p>
      {description ? <Text className="mt-1 !text-xs">{description}</Text> : null}
      <div className="mt-3">{children}</div>
    </section>
  )
}

/** Live progress log — plane 3, bounded height, the data scrolls inside it. */
function ProgressLog({ lines, running }: { lines: { key: string; head: string; detail: string | null }[]; running: boolean }) {
  if (lines.length === 0 && !running) return null
  return (
    <div className="mt-3 max-h-64 overflow-y-auto rounded-lg bg-black/20 p-3 ring-1 ring-inset ring-white/5">
      <ol className="flex flex-col gap-2">
        {lines.map((line) => (
          <li key={line.key} className="text-xs leading-5">
            <span className="text-zinc-200">{line.head}</span>
            {line.detail ? <span className="text-zinc-400"> — {line.detail}</span> : null}
          </li>
        ))}
        {running ? (
          <li className="flex items-center gap-2 text-xs text-zinc-400">
            <Spinner className="size-3 animate-spin" />
            <span>Waiting for the next event…</span>
          </li>
        ) : null}
      </ol>
    </div>
  )
}

export function EvolutionWorkbench({
  copilotId,
  capabilities,
  testSuites,
  benchmarkSuites,
  latestProposal,
  comparison,
  candidateLabel,
}: EvolutionWorkbenchProps) {
  const router = useRouter()

  const [generating, setGenerating] = useState(false)
  const [generateError, setGenerateError] = useState<string | null>(null)
  const [generateNote, setGenerateNote] = useState<string | null>(null)

  const [testRunning, setTestRunning] = useState<string | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [testLines, setTestLines] = useState<TestLine[]>([])
  const [testVerdict, setTestVerdict] = useState<string | null>(null)

  const [benchRunning, setBenchRunning] = useState<string | null>(null)
  const [benchError, setBenchError] = useState<string | null>(null)
  const [benchNote, setBenchNote] = useState<string | null>(null)

  const [autoRunning, setAutoRunning] = useState(false)
  const [autoLines, setAutoLines] = useState<AutoLine[]>([])
  const [autoResult, setAutoResult] = useState<AutoImprovementResult | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [creatingV2, setCreatingV2] = useState(false)
  const [v2Error, setV2Error] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)

  // Monotonic key source for log lines. Two events of the same type in the same
  // iteration are legitimate, so the type+iteration pair is NOT a stable React
  // key — a counter is.
  const seq = useRef(0)
  const nextKey = useCallback(() => {
    seq.current += 1
    return `evt-${seq.current}`
  }, [])

  /**
   * POST + surface the route's own error text. The routes hand-author their
   * error strings (`copilot not found`, `an improvement cycle is already
   * running…`); forwarding them verbatim is more useful than a generic message,
   * and none of them carries backend detail.
   */
  const post = useCallback(
    async (
      path: string,
      body: Record<string, unknown>,
      onError: (msg: string) => void
    ): Promise<Record<string, unknown> | null> => {
      try {
        const res = await fetch(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const payload = (await res.json().catch(() => null)) as Record<string, unknown> | null
        if (!res.ok) {
          const message = typeof payload?.error === 'string' ? payload.error : `Request failed (${res.status}).`
          onError(message)
          return null
        }
        router.refresh()
        // A 2xx whose body did not parse is still a success — the write
        // happened. `{}` keeps "succeeded, told us nothing" distinguishable
        // from the `null` this returns on failure.
        return payload ?? {}
      } catch {
        onError('The request never reached the server. Check that the backend is running.')
        return null
      }
    },
    [router]
  )

  async function handleGenerateSuite() {
    if (generating) return
    setGenerating(true)
    setGenerateError(null)
    setGenerateNote(null)
    const payload = await post(`/api/agent-ops/copilots/${copilotId}/tests/generate`, {}, setGenerateError)
    if (payload !== null) {
      setGenerateNote(
        payload.alreadyExists === true
          ? 'A suite already existed — nothing was written.'
          : 'Suite generated. The counts below refresh with the page.'
      )
    }
    setGenerating(false)
  }

  async function handleRunTests(suiteId: string, suiteName: string) {
    if (testRunning !== null) return
    setTestRunning(suiteId)
    setTestError(null)
    setTestVerdict(null)
    setTestLines([{ key: nextKey(), label: `Starting ${suiteName}`, detail: null }])
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/tests/run/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: JSON.stringify({ suiteId }),
      })
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setTestError(payload?.error ?? `The test run could not start (${res.status}).`)
        return
      }
      await consumeSSE<TestFrame>(res.body, (frame) => {
        switch (frame.type) {
          case 'run-started':
            setTestLines((prev) => [
              ...prev,
              { key: nextKey(), label: `Run started — ${frame.total} case${frame.total === 1 ? '' : 's'}`, detail: null },
            ])
            break
          case 'case-started':
            setTestLines((prev) => [
              ...prev,
              { key: nextKey(), label: `Case ${frame.index}/${frame.total}`, detail: frame.name },
            ])
            break
          case 'case-completed':
            setTestLines((prev) => [
              ...prev,
              { key: nextKey(), label: `Case verdict: ${frame.status}`, detail: frame.failureReason },
            ])
            break
          case 'run-finished':
            setTestLines((prev) => [
              ...prev,
              { key: nextKey(), label: `Run finished (${frame.status})`, detail: `Pass rate ${formatRate(frame.passRate)}` },
            ])
            break
          case 'done':
            setTestVerdict(`Pass rate ${formatRate(frame.testRun.passRate)} on run ${frame.testRun.id}.`)
            break
          case 'error':
            setTestError(frame.error ?? 'The test run failed.')
            break
          default:
            // `case-thread` / `case-node` are graph plumbing, not operator news.
            break
        }
      })
    } catch {
      setTestError('The stream dropped before the run finished. The server may still be running it.')
    } finally {
      setTestRunning(null)
      router.refresh()
    }
  }

  async function handleRunBenchmark(suiteId: string) {
    if (benchRunning !== null) return
    setBenchRunning(suiteId)
    setBenchError(null)
    setBenchNote(null)
    const payload = await post(`/api/agent-ops/copilots/${copilotId}/benchmarks/run`, { suiteId }, setBenchError)
    if (payload !== null) setBenchNote('Benchmark recorded. Scores below refresh with the page.')
    setBenchRunning(null)
  }

  async function handleAutoImprove() {
    if (autoRunning) return
    setAutoRunning(true)
    setAutoLines([])
    setAutoResult(null)
    setAutoError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/improve/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: '{}',
      })
      if (!res.ok || !res.body) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        setAutoError(payload?.error ?? `Auto-improve could not start (${res.status}).`)
        return
      }
      await consumeSSE<AutoFrame>(res.body, (frame) => {
        if (frame.type === 'done') {
          setAutoResult(frame)
          return
        }
        if (frame.type === 'error' && !('iteration' in frame)) {
          setAutoError(frame.error)
          return
        }
        const event = frame as AutoImproveEvent
        // Cost and pass rate are only present on the events that measured them;
        // absent stays absent rather than becoming $0.00 / 0%.
        const parts = [
          event.detail,
          typeof event.passRate === 'number' ? `pass rate ${formatRate(event.passRate)}` : null,
          typeof event.costUsd === 'number' ? `spent $${event.costUsd.toFixed(3)}` : null,
        ].filter((p): p is string => typeof p === 'string' && p.length > 0)
        setAutoLines((prev) => [
          ...prev,
          {
            key: nextKey(),
            step: AUTO_STEP_LABELS[event.type],
            detail: parts.length > 0 ? parts.join(' · ') : null,
            iteration: event.iteration,
          },
        ])
      })
    } catch {
      setAutoError('The stream dropped before the cycle finished. The server may still be running it.')
    } finally {
      setAutoRunning(false)
      // The loop never approves: reload so the proposal + comparison below show
      // what it produced, and the human decides.
      router.refresh()
    }
  }

  async function handleAnalyze() {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeError(null)
    await post(`/api/agent-ops/copilots/${copilotId}/improve/analyze`, {}, setAnalyzeError)
    setAnalyzing(false)
  }

  async function handleCreateV2() {
    if (creatingV2 || latestProposal === null) return
    setCreatingV2(true)
    setV2Error(null)
    await post(`/api/agent-ops/copilots/${copilotId}/improve/create-v2`, { proposalId: latestProposal.id }, setV2Error)
    setCreatingV2(false)
  }

  async function handleDecide(decision: 'approved' | 'rejected') {
    if (deciding !== null || latestProposal === null) return
    setDeciding(decision)
    setDecisionError(null)
    await post(
      `/api/agent-ops/copilots/${copilotId}/improve/decision`,
      { proposalId: latestProposal.id, decision },
      setDecisionError
    )
    setDeciding(null)
  }

  const generateCap = capabilities['generate-suite']
  const testCap = capabilities['run-tests']
  const benchCap = capabilities['run-benchmark']
  const autoCap = capabilities['auto-improve']
  const v2Cap = capabilities['create-v2']
  const decideCap = capabilities.decide

  // `decide` is `degraded` exactly when only rejection is legal (no V2 yet):
  // approval would mark a candidate that does not exist as shippable.
  const approveBlocked = decideCap.state !== 'available'
  const rejectBlocked = decideCap.state === 'unavailable'

  const changeEntries = latestProposal
    ? (Object.entries(latestProposal.manifestChanges) as Array<
        [keyof ImprovementManifestChanges, { from: string | string[] | number; to: string | string[] | number; why: string }]
      >)
    : []

  return (
    <div className="flex flex-col gap-4">
      <Block
        title="Test suites"
        description="Suites are derived from this agent's own manifest — generating one costs an LLM call, running one executes the agent."
      >
        <div className="flex flex-col gap-4">
          <div>
            <Button color="accent" disabled={generateCap.state !== 'available' || generating} onClick={handleGenerateSuite}>
              {generating ? <Spinner /> : null}
              Generate suite
            </Button>
            <CapabilityNote capability={generateCap} />
            {generateNote ? <p className="mt-2 text-xs text-zinc-400">{generateNote}</p> : null}
            {generateError ? <ErrorBanner message={generateError} /> : null}
          </div>

          <div>
            <CapabilityNote capability={testCap} />
            {testSuites.length === 0 ? (
              <Text className="!text-xs">No test suite is persisted for this agent.</Text>
            ) : (
              <ul className="flex flex-col">
                {testSuites.map((suite) => (
                  <li
                    key={suite.id}
                    className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0"
                  >
                    <span className="min-w-0 truncate text-sm text-zinc-300">{suite.name}</span>
                    <Button
                      outline
                      disabled={testCap.state === 'unavailable' || testRunning !== null}
                      onClick={() => handleRunTests(suite.id, suite.name)}
                    >
                      {testRunning === suite.id ? <Spinner /> : null}
                      Run tests
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            <ProgressLog
              running={testRunning !== null}
              lines={testLines.map((l) => ({ key: l.key, head: l.label, detail: l.detail }))}
            />
            {testVerdict ? <p className="mt-2 font-mono text-xs tabular-nums text-zinc-300">{testVerdict}</p> : null}
            {testError ? <ErrorBanner message={testError} /> : null}
          </div>
        </div>
      </Block>

      <Block title="Benchmarks" description="A scored evaluation of this agent, pinned to the version it ran on.">
        <CapabilityNote capability={benchCap} />
        {benchmarkSuites.length === 0 ? (
          <Text className="!text-xs">No benchmark suite is persisted for this agent.</Text>
        ) : (
          <ul className="flex flex-col">
            {benchmarkSuites.map((suite) => (
              <li
                key={suite.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-0"
              >
                <span className="min-w-0 truncate text-sm text-zinc-300">{suite.name}</span>
                <Button
                  outline
                  disabled={benchCap.state === 'unavailable' || benchRunning !== null}
                  onClick={() => handleRunBenchmark(suite.id)}
                >
                  {benchRunning === suite.id ? <Spinner /> : null}
                  Run benchmark
                </Button>
              </li>
            ))}
          </ul>
        )}
        {benchNote ? <p className="mt-2 text-xs text-zinc-400">{benchNote}</p> : null}
        {benchError ? <ErrorBanner message={benchError} /> : null}
      </Block>

      <Block
        title="Auto-improve"
        description="Analyse → V2 → re-run → compare, looping until convergence, plateau, or the iteration/cost ceiling. It stops before approval: it never approves and never promotes."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button color="accent" disabled={autoCap.state !== 'available' || autoRunning} onClick={handleAutoImprove}>
            {autoRunning ? <Spinner /> : null}
            Run auto-improve
          </Button>
          <Button outline disabled={autoCap.state !== 'available' || analyzing || autoRunning} onClick={handleAnalyze}>
            {analyzing ? <Spinner /> : null}
            Analyse once
          </Button>
        </div>
        <CapabilityNote capability={autoCap} />
        {analyzeError ? <ErrorBanner message={analyzeError} /> : null}

        <ProgressLog
          running={autoRunning}
          lines={autoLines.map((l) => ({
            key: l.key,
            head: `Iteration ${l.iteration} · ${l.step}`,
            detail: l.detail,
          }))}
        />

        {autoResult ? (
          <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            <div>
              <dt className={eyebrowClass}>Iterations</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">{autoResult.iterations}</dd>
            </div>
            <div>
              <dt className={eyebrowClass}>Final pass rate</dt>
              <dd className="mt-1 font-mono text-sm tabular-nums text-zinc-200">{formatRate(autoResult.finalPassRate)}</dd>
            </div>
            <div className="col-span-2">
              <dt className={eyebrowClass}>Stopped because</dt>
              <dd className="mt-1 text-xs leading-5 text-zinc-300">
                {STOPPED_BY_LABELS[autoResult.stoppedBy]}
                {autoResult.stopDetail ? <span className="text-zinc-400"> {autoResult.stopDetail}</span> : null}
              </dd>
            </div>
          </dl>
        ) : null}
        {autoError ? <ErrorBanner message={autoError} /> : null}
      </Block>

      <Block
        title="Proposal"
        description="The improvement architect's reading of the observed failures, and the manifest changes it proposes."
      >
        {latestProposal === null ? (
          <Text className="!text-xs">
            No improvement proposal exists for this agent. Auto-improve or a single analysis writes one.
          </Text>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="text-sm text-zinc-300">{PROPOSAL_STATUS_LABELS[latestProposal.status]}</span>
              <span className="font-mono text-xs tabular-nums text-zinc-400">{latestProposal.id}</span>
              <span className="font-mono text-xs tabular-nums text-zinc-400">
                ${latestProposal.costUsd.toFixed(3)} spent analysing
              </span>
            </div>

            <p className="text-sm leading-6 text-zinc-300">{latestProposal.summary}</p>

            {latestProposal.failureAnalysis.length > 0 ? (
              <div>
                <p className={eyebrowClass}>Failures analysed</p>
                <ul className="mt-2 flex flex-col">
                  {latestProposal.failureAnalysis.map((entry, index) => (
                    <li
                      key={`${entry.caseId ?? entry.caseName}-${index}`}
                      className="border-b border-white/5 py-2.5 text-xs leading-5 last:border-0"
                    >
                      <p className="text-zinc-200">{entry.caseName}</p>
                      <p className="mt-1 text-zinc-300">{entry.rootCause}</p>
                      <p className="mt-1 text-zinc-400">{entry.evidence}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {changeEntries.length > 0 ? (
              <div>
                <p className={eyebrowClass}>Manifest changes</p>
                <ul className="mt-2 flex flex-col gap-3">
                  {changeEntries.map(([field, change]) => (
                    <li key={field} className="rounded-lg bg-black/20 p-3 ring-1 ring-inset ring-white/5">
                      <p className="text-xs font-medium text-zinc-200">{MANIFEST_FIELD_LABELS[field]}</p>
                      <dl className="mt-2 flex flex-col gap-2 text-xs leading-5">
                        <div className="flex gap-2">
                          <dt className="w-10 shrink-0 text-zinc-400">From</dt>
                          <dd className="min-w-0 break-words text-zinc-400">{formatManifestValue(change.from)}</dd>
                        </div>
                        <div className="flex gap-2">
                          <dt className="w-10 shrink-0 text-zinc-400">To</dt>
                          <dd className="min-w-0 break-words text-zinc-200">{formatManifestValue(change.to)}</dd>
                        </div>
                      </dl>
                      <p className="mt-2 text-xs leading-5 text-zinc-400">{change.why}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Text className="!text-xs">This proposal changes no manifest field.</Text>
            )}

            <div>
              <Button color="accent" disabled={v2Cap.state !== 'available' || creatingV2} onClick={handleCreateV2}>
                {creatingV2 ? <Spinner /> : null}
                Create V2 draft
              </Button>
              <CapabilityNote capability={v2Cap} />
              {v2Error ? <ErrorBanner message={v2Error} /> : null}
            </div>
          </div>
        )}
      </Block>

      <Block
        title="V1 vs V2"
        description={
          candidateLabel
            ? `Latest completed run per suite, for the base version and for ${candidateLabel}.`
            : 'Latest completed run per suite, for the base version and its V2.'
        }
      >
        {comparison === null ? (
          <Text className="!text-xs">No V2 exists yet, so there is nothing to compare.</Text>
        ) : (
          <div className="flex flex-col gap-4">
            <div>
              <p className={eyebrowClass}>Tests</p>
              {comparison.tests.length === 0 ? (
                <Text className="!text-xs">No test suite to compare.</Text>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {comparison.tests.map((row) => (
                    <li
                      key={row.suiteId}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-white/5 py-2.5 last:border-0"
                    >
                      <span className="min-w-0 truncate text-xs text-zinc-300">{row.suiteName}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-400">V1 {formatRate(row.v1?.passRate)}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-200">V2 {formatRate(row.v2?.passRate)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className={eyebrowClass}>Benchmarks</p>
              {comparison.benchmarks.length === 0 ? (
                <Text className="!text-xs">No benchmark suite to compare.</Text>
              ) : (
                <ul className="mt-2 flex flex-col">
                  {comparison.benchmarks.map((row) => (
                    <li
                      key={row.suiteId}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-white/5 py-2.5 last:border-0"
                    >
                      <span className="min-w-0 truncate text-xs text-zinc-300">{row.suiteName}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-400">V1 {formatScore(row.v1?.score)}</span>
                      <span className="font-mono text-xs tabular-nums text-zinc-200">V2 {formatScore(row.v2?.score)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Block>

      <Block
        title="Decision"
        description="A decision is final: the route answers 409 on a second one. Approving marks the V2 as the shippable candidate — it does not promote it."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button color="accent" disabled={approveBlocked || deciding !== null} onClick={() => handleDecide('approved')}>
            {deciding === 'approved' ? <Spinner /> : null}
            Approve
          </Button>
          <Button outline disabled={rejectBlocked || deciding !== null} onClick={() => handleDecide('rejected')}>
            {deciding === 'rejected' ? <Spinner /> : null}
            Reject
          </Button>
        </div>
        <CapabilityNote capability={decideCap} />
        {decisionError ? <ErrorBanner message={decisionError} /> : null}
      </Block>
    </div>
  )
}
