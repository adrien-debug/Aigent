'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { Alert, AlertActions, AlertDescription, AlertTitle } from '@/components/catalyst/alert'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { consumeSSE } from '@/lib/agent-mission-control/sse-client'
import { formatPercent, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import {
  FIX_TYPE_LABELS,
  type FailureDiagnosis,
  type NextRecommendedAction,
} from '@/lib/agent-mission-control/improvement-diagnosis'
import type {
  AutoImproveEvent,
  AutoImprovementResult,
  BenchmarkSignal,
  ImprovementManifestChanges,
  ImprovementProposal,
  SuiteSignal,
  VersionComparison,
} from '@/lib/agent-mission-control/improvement-loop'

/** SSE frames from the auto-improve route: the per-step events + a terminal `done`. */
type AutoImproveFrame = AutoImproveEvent | ({ type: 'done' } & AutoImprovementResult)

/** One-line human label for a live auto-improve frame. */
function autoFrameLabel(ev: AutoImproveEvent): string {
  switch (ev.type) {
    case 'iteration-start':
      return `Iteration ${ev.iteration} — starting`
    case 'analyzed':
      return `Iteration ${ev.iteration} — analyzed${ev.costUsd != null ? ` · ${formatUsd(ev.costUsd)}` : ''}`
    case 'v2-created':
      return `Iteration ${ev.iteration} — V2 created`
    case 'reran':
      return `Iteration ${ev.iteration} — re-ran V2${ev.passRate != null ? ` · ${formatPercent(ev.passRate)} pass` : ''}${ev.costUsd != null ? ` · ${formatUsd(ev.costUsd)}` : ''}`
    case 'converged':
      return `Iteration ${ev.iteration} — converged`
    case 'plateau':
      return `Iteration ${ev.iteration} — plateau`
    case 'exhausted':
      return `Iteration ${ev.iteration} — ${ev.detail ?? 'budget or max iterations reached'}`
    case 'error':
      return `Iteration ${ev.iteration} — ${ev.detail ?? 'error'}`
  }
}

/** Terminal summary line, keyed on why the loop stopped. */
function autoResultLabel(r: AutoImprovementResult): string {
  switch (r.stoppedBy) {
    case 'converged':
      return `Converged at 100% after ${r.iterations} iteration(s) — review & approve below.`
    case 'plateau':
      return `Plateau at ${formatPercent(r.finalPassRate)} — no further gain. Review below.`
    case 'budget':
      return `Budget reached after ${r.iterations} iteration(s) — review below.`
    case 'max-iterations':
      return `Max iterations reached (${r.iterations}) — review below.`
    case 'nothing-to-improve':
      return 'Nothing left to improve — the agent already passes its suites.'
  }
}

// ---------------------------------------------------------------------------
// Loop stepper — where the current cycle stands. Meaning is carried by the
// LABEL + a solid accent dot on the active step (doctrine: never colour alone).
// ---------------------------------------------------------------------------

type LoopStage = 'analyze' | 'proposal' | 'v2' | 'rerun' | 'decision'

const LOOP_STEPS: Array<{ id: LoopStage; label: string }> = [
  { id: 'analyze', label: 'Analyze' },
  { id: 'proposal', label: 'Proposal' },
  { id: 'v2', label: 'V2 draft' },
  { id: 'rerun', label: 'Re-run & compare' },
  { id: 'decision', label: 'Human decision' },
]

function currentStage(proposal: ImprovementProposal | null, hasV2Results: boolean): LoopStage {
  if (!proposal) return 'analyze'
  if (proposal.status === 'proposed') return 'v2'
  if (proposal.status === 'v2-created') return hasV2Results ? 'decision' : 'rerun'
  return 'decision'
}

/**
 * The single IMMEDIATE thing to do at the current step — the "do Y now" half of
 * the guidance line. Points at the action the operator can take on THIS screen,
 * not the type of fix (that's carried by `nextAction`). `null` once the cycle is
 * closed (approved/rejected) — nothing left to do here.
 */
function stageGuidance(
  proposal: ImprovementProposal | null,
  hasV2Results: boolean
): { step: string; action: string } | null {
  if (proposal && (proposal.status === 'approved' || proposal.status === 'rejected')) return null
  switch (currentStage(proposal, hasV2Results)) {
    case 'analyze':
      return { step: 'Analyze', action: 'Run “Analyze & propose” to turn the failing cases below into a root-cause proposal.' }
    case 'v2':
      return { step: 'Proposal', action: 'Review the manifest diff, then “Create V2 draft” to materialize it as a testable version.' }
    case 'rerun':
      return { step: 'Re-run & compare', action: 'Re-run each suite pinned to V2 so the V1 vs V2 comparison has real evidence.' }
    case 'decision':
      return { step: 'Human decision', action: 'Read the V1 vs V2 delta, then approve or reject this cycle. Promotion stays separate.' }
    default:
      return null
  }
}

/** Tiny check glyph for completed steps — meaning is carried by the mark, not colour. */
function CheckMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" fill="none" className={className}>
      <path d="M2.5 6.5 5 9l4.5-5" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function LoopStepper({ proposal, hasV2Results }: { proposal: ImprovementProposal | null; hasV2Results: boolean }) {
  const stage = currentStage(proposal, hasV2Results)
  const closed = proposal !== null && (proposal.status === 'approved' || proposal.status === 'rejected')
  const activeIndex = LOOP_STEPS.findIndex((s) => s.id === stage)

  // Cycle closed → the stepper must NOT read as "in progress" with 5 live ✓
  // above a screen that invites a fresh cycle. Show a terminal summary instead,
  // so the state matches the Auto-improve / Analyze actions below.
  if (closed) {
    const approved = proposal!.status === 'approved'
    return (
      <div
        aria-label="Improvement loop status"
        className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--accent-surface)] px-3 py-2 text-xs ring-1 ring-[var(--accent-line)]"
      >
        <span
          aria-hidden="true"
          className={
            'flex size-4 items-center justify-center rounded-full ' +
            (approved ? 'bg-accent-500 text-zinc-950' : 'bg-zinc-300 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300')
          }
        >
          <CheckMark className="size-2.5" />
        </span>
        <span className="font-semibold text-zinc-700 dark:text-zinc-200">
          Last cycle {approved ? 'approved' : 'rejected'}
        </span>
        <span className="text-zinc-500 dark:text-zinc-400">— start a new one below to keep improving.</span>
      </div>
    )
  }

  return (
    <nav aria-label="Improvement loop progress" className="no-scrollbar overflow-x-auto">
      <ol className="flex w-max min-w-full items-center gap-2">
        {LOOP_STEPS.map((step, i) => {
          const done = i < activeIndex || closed
          const active = i === activeIndex && !closed
          return (
            <li key={step.id} className="flex shrink-0 items-center gap-2" aria-current={active ? 'step' : undefined}>
              {i > 0 ? (
                <span
                  aria-hidden="true"
                  className={'h-px w-6 ' + (i <= activeIndex || closed ? 'bg-[var(--accent-line)]' : 'bg-zinc-950/10 dark:bg-white/10')}
                />
              ) : null}
              <span
                className={
                  'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs ' +
                  (active
                    ? 'bg-[var(--accent-surface)] font-semibold text-accent-700 ring-1 ring-[var(--accent-line-strong)] dark:text-accent-300'
                    : done
                      ? 'font-medium text-zinc-700 dark:text-zinc-300'
                      : 'font-medium text-zinc-400 dark:text-zinc-600')
                }
              >
                <span
                  aria-hidden="true"
                  className={
                    'flex size-4 items-center justify-center rounded-full text-[10px] font-semibold ' +
                    (active
                      ? 'bg-accent-500 text-zinc-950'
                      : done
                        ? 'bg-[var(--accent-surface)] text-accent-700 ring-1 ring-[var(--accent-line)] dark:text-accent-300'
                        : 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500')
                  }
                >
                  {done ? <CheckMark className="size-2.5" /> : i + 1}
                </span>
                {step.label}
              </span>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Small display helpers
// ---------------------------------------------------------------------------

function SourceBadges({ sources }: { sources: ImprovementProposal['sources'] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge color="zinc">Aigent DB</Badge>
      <Badge color={sources.langgraph ? 'accent' : 'zinc'}>
        {sources.langgraph ? 'LangGraph threads' : `LangGraph — ${sources.langgraphReason ?? 'unavailable'}`}
      </Badge>
      <Badge color={sources.langsmith ? 'accent' : 'zinc'}>
        {sources.langsmith ? 'LangSmith traces' : `LangSmith — ${sources.langsmithReason ?? 'unavailable'}`}
      </Badge>
    </div>
  )
}

/** "+13 pts" / "−4 pts" / "±0" — sign always spelled out, never colour alone. */
function DeltaText({ v1, v2, unit }: { v1: number | null; v2: number | null; unit: 'pct' | 'pts' }) {
  if (v1 === null || v2 === null) return <span className="text-zinc-500">—</span>
  const delta = unit === 'pct' ? Math.round((v2 - v1) * 100) : Math.round((v2 - v1) * 10) / 10
  const up = delta > 0
  const flat = delta === 0
  return (
    <span className={'inline-flex items-center gap-1.5 font-medium ' + (up ? 'text-accent-700 dark:text-accent-300' : 'text-zinc-600 dark:text-zinc-400')}>
      <span aria-hidden="true" className={'size-1.5 rounded-full ' + (up ? 'bg-accent-500' : 'bg-zinc-400')} />
      {flat ? '±0' : `${up ? '+' : '−'}${Math.abs(delta)}`} pts
    </span>
  )
}

const CHANGE_FIELD_LABELS: Record<keyof ImprovementManifestChanges, string> = {
  systemPromptSummary: 'System prompt',
  forbiddenActions: 'Forbidden actions',
  alwaysConfirmActions: 'Always-confirm actions',
  confirmationPolicy: 'Confirmation policy',
  maxStepsPerRun: 'Max steps per run',
  outputContractInvariants: 'Output invariants',
}

function renderValue(v: string | string[] | number): string {
  if (Array.isArray(v)) return v.length > 0 ? v.join(' · ') : '(empty)'
  return String(v)
}

// ---------------------------------------------------------------------------
// Workbench
// ---------------------------------------------------------------------------

export interface ImproveWorkbenchProps {
  copilotId: string
  copilotName: string
  baseVersion: { id: string; label: string; stage: string }
  v2Version: { id: string; label: string; stage: string } | null
  proposal: ImprovementProposal | null
  suites: SuiteSignal[]
  benchmarks: BenchmarkSignal[]
  comparison: VersionComparison | null
  /** Deterministic per-failure classification, recomputed live by the page. */
  diagnoses: FailureDiagnosis[]
  nextAction: NextRecommendedAction | null
}

/** Compact classification line rendered under a failing case. */
function DiagnosisLine({ diagnosis }: { diagnosis: FailureDiagnosis }) {
  const runtime = diagnosis.recommendedFixType === 'graph_runtime_patch'
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2">
      <Badge color={runtime ? 'accent' : 'zinc'}>{diagnosis.category}</Badge>
      <span className="text-xs text-zinc-500">{Math.round(diagnosis.confidence * 100)}% confidence</span>
      <span className="text-xs text-zinc-600 dark:text-zinc-400">fix: {FIX_TYPE_LABELS[diagnosis.recommendedFixType]}</span>
      {diagnosis.evidence[0] ? <span className="w-full text-xs text-zinc-500">{diagnosis.evidence[0]}</span> : null}
    </div>
  )
}

export function ImproveWorkbench({
  copilotId,
  copilotName,
  baseVersion,
  v2Version,
  proposal,
  suites,
  benchmarks,
  comparison,
  diagnoses,
  nextAction,
}: ImproveWorkbenchProps) {
  const diagnosisByCaseId = new Map(diagnoses.map((d) => [d.testCaseId, d]))
  const router = useRouter()
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [creatingV2, setCreatingV2] = useState(false)
  const [v2Error, setV2Error] = useState<string | null>(null)
  const [rerunning, setRerunning] = useState<string | null>(null)
  const [rerunError, setRerunError] = useState<string | null>(null)
  const [deciding, setDeciding] = useState<'approved' | 'rejected' | null>(null)
  const [decisionError, setDecisionError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<'approved' | 'rejected' | null>(null)
  // Auto-improve: the loop runs analyze→create-v2→re-run→compare on its own and
  // STOPS before approval (never auto-approves — the human still approves below).
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoFrames, setAutoFrames] = useState<AutoImproveEvent[]>([])
  const [autoResult, setAutoResult] = useState<AutoImprovementResult | null>(null)
  const [autoError, setAutoError] = useState<string | null>(null)

  const totalFailures = suites.reduce((n, s) => n + s.failures.length, 0)
  const hasV2Results = Boolean(
    comparison && (comparison.tests.some((t) => t.v2 !== null) || comparison.benchmarks.some((b) => b.v2 !== null))
  )
  const cycleOpen = proposal !== null && (proposal.status === 'proposed' || proposal.status === 'v2-created')
  const guidance = stageGuidance(proposal, hasV2Results)
  // At the re-run step the re-runs ARE the primary action — the first test
  // re-run is promoted to a solid accent button so it can't be mistaken for a
  // secondary control. Once V2 results exist we're at the decision step, so the
  // re-runs drop back to outline (refresh, not the headline).
  const atRerunStep = currentStage(proposal, hasV2Results) === 'rerun'

  async function post(path: string, body: Record<string, unknown>, onError: (msg: string) => void): Promise<boolean> {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        onError(payload?.error ?? `Request failed (${res.status}).`)
        return false
      }
      router.refresh()
      return true
    } catch {
      onError('Live backend not configured.')
      return false
    }
  }

  async function handleAnalyze() {
    if (analyzing) return
    setAnalyzing(true)
    setAnalyzeError(null)
    await post(`/api/agent-ops/copilots/${copilotId}/improve/analyze`, {}, setAnalyzeError)
    setAnalyzing(false)
  }

  async function handleAutoImprove() {
    if (autoRunning) return
    setAutoRunning(true)
    setAutoFrames([])
    setAutoResult(null)
    setAutoError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/improve/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: '{}',
      })
      if (!res.ok || !res.body) {
        setAutoError(
          res.status === 401 || res.status === 403
            ? 'Auto-improve could not start — your session expired. Sign in again.'
            : res.status === 503
              ? 'Auto-improve could not start — live backend not configured.'
              : `Auto-improve could not start (${res.status}).`
        )
        return
      }
      await consumeSSE<AutoImproveFrame>(res.body, (ev) => {
        if (ev.type === 'done') {
          setAutoResult(ev)
        } else {
          if (ev.type === 'error') setAutoError(ev.detail ?? 'Auto-improve failed.')
          setAutoFrames((prev) => [...prev, ev])
        }
      })
    } catch {
      setAutoError('Auto-improve failed — the backend is unreachable.')
    } finally {
      setAutoRunning(false)
      // Reload so the proposal + V1/V2 comparison + Approve buttons reflect the
      // V2 the loop just produced. The loop NEVER approves — the human does.
      router.refresh()
    }
  }

  async function handleCreateV2() {
    if (creatingV2 || !proposal) return
    setCreatingV2(true)
    setV2Error(null)
    await post(`/api/agent-ops/copilots/${copilotId}/improve/create-v2`, { proposalId: proposal.id }, setV2Error)
    setCreatingV2(false)
  }

  async function handleRerunTests(suiteId: string) {
    if (rerunning || !proposal?.v2VersionId) return
    setRerunning(`test:${suiteId}`)
    setRerunError(null)
    await post(
      `/api/agent-ops/copilots/${copilotId}/tests/run`,
      { suiteId, versionId: proposal.v2VersionId },
      setRerunError
    )
    setRerunning(null)
  }

  async function handleRerunBenchmark(suiteId: string) {
    if (rerunning || !proposal?.v2VersionId) return
    setRerunning(`bench:${suiteId}`)
    setRerunError(null)
    await post(
      `/api/agent-ops/copilots/${copilotId}/benchmarks/run`,
      { suiteId, versionId: proposal.v2VersionId },
      setRerunError
    )
    setRerunning(null)
  }

  async function handleDecide(decision: 'approved' | 'rejected') {
    if (deciding || !proposal) return
    setConfirming(null)
    setDeciding(decision)
    setDecisionError(null)
    await post(
      `/api/agent-ops/copilots/${copilotId}/improve/decision`,
      { proposalId: proposal.id, decision },
      setDecisionError
    )
    setDeciding(null)
  }

  const changeEntries = proposal
    ? (Object.entries(proposal.manifestChanges) as Array<
        [keyof ImprovementManifestChanges, { from: string | string[] | number; to: string | string[] | number; why: string }]
      >)
    : []

  return (
    <div className="space-y-8">
      <LoopStepper proposal={proposal} hasV2Results={hasV2Results} />

      {/* Guidance banner — "you are at step X, do Y now". The step line always
          names the IMMEDIATE action of the current step (from stageGuidance);
          nextAction adds the deterministic verdict ("manifest won't fix it")
          when the diagnoses have one to say. */}
      {guidance || nextAction ? (
        <div className="rounded-xl bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--accent-line)]">
          {guidance ? (
            <>
              <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                Next step — {guidance.step}
              </p>
              <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{guidance.action}</p>
            </>
          ) : null}
          {nextAction ? (
            <div className={guidance ? 'mt-3 border-t border-[var(--accent-line)] pt-3' : ''}>
              <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                Recommended fix — {nextAction.label}
              </p>
              <p className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">{nextAction.headline}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* 1. Base signals — what the loop improves FROM.                      */}
      {/* ------------------------------------------------------------------ */}
      <AgentSectionCard
        title={`Base signals — ${baseVersion.label}`}
        description={`Latest real test and benchmark results for ${copilotName}. The proposal is grounded in these failures — nothing is fabricated.`}
        actions={
          !cycleOpen ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                color="accent"
                onClick={handleAutoImprove}
                disabled={autoRunning || analyzing || totalFailures === 0}
              >
                {autoRunning ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="size-4" /> Auto-improving…
                  </span>
                ) : (
                  'Auto-improve'
                )}
              </Button>
              <Button outline onClick={handleAnalyze} disabled={analyzing || autoRunning || totalFailures === 0}>
                {analyzing ? (
                  <span className="inline-flex items-center gap-2">
                    <Spinner className="size-4" /> Analyzing…
                  </span>
                ) : (
                  'Analyze & propose'
                )}
              </Button>
            </div>
          ) : null
        }
      >
        <div className="space-y-5">
          {/* Auto-improve: it loops until 100% or plateau, then STOPS for your
              approval — it never promotes on its own. */}
          {!cycleOpen ? (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Auto-improve runs the loop until 100% or a plateau — you still approve the result.
            </p>
          ) : null}
          {autoFrames.length > 0 || autoResult || autoRunning ? (
            <div className="rounded-xl bg-[var(--accent-soft)] p-4 ring-1 ring-[var(--accent-line)]">
              <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                Auto-improve progress
              </p>
              <ul className="mt-2 space-y-1">
                {autoFrames.map((ev, i) => (
                  <li key={i} className="flex items-center gap-2 font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">
                    <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-accent-500" />
                    {autoFrameLabel(ev)}
                  </li>
                ))}
                {autoRunning ? (
                  <li className="flex items-center gap-2 text-xs text-zinc-500">
                    <Spinner className="size-3.5" /> running…
                  </li>
                ) : null}
              </ul>
              {autoResult ? (
                <p className="mt-3 border-t border-[var(--accent-line)] pt-3 text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {autoResultLabel(autoResult)}
                </p>
              ) : null}
            </div>
          ) : null}
          {autoError ? <ErrorBanner message={autoError} /> : null}
          {analyzeError ? <ErrorBanner message={analyzeError} /> : null}
          {analyzing ? (
            <Text>
              Collecting live signals (tests, benchmarks, runs, LangGraph threads, LangSmith traces) and asking the
              architect model for a root-cause proposal — this takes a moment.
            </Text>
          ) : null}
          {suites.length === 0 ? (
            <Text>No test suite exists for this copilot yet — the loop needs real signals to improve from.</Text>
          ) : (
            <ul className="space-y-4">
              {suites.map((s) => (
                <li key={s.suiteId}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-zinc-950 dark:text-white">{s.suiteName}</span>
                    <Badge color="zinc">{s.kind}</Badge>
                    {s.lastRun ? (
                      <Badge color={s.failures.length === 0 ? 'accent' : 'zinc'}>
                        {formatPercent(s.lastRun.passRate)} pass
                      </Badge>
                    ) : (
                      <Badge color="zinc">never run</Badge>
                    )}
                  </div>
                  {s.failures.length > 0 ? (
                    <ul className="mt-3 divide-y divide-white/5 border-t border-white/5">
                      {s.failures.map((f) => (
                        <li key={f.caseName} className="py-3 first:pt-3">
                          <p className="text-sm font-medium text-zinc-950 dark:text-white">
                            {f.caseName} <span className="font-normal text-zinc-500">— {f.status}</span>
                          </p>
                          {f.failureReason ? (
                            <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">{f.failureReason}</p>
                          ) : null}
                          <p className="mt-1 text-xs break-words text-zinc-500">
                            expected: {f.expectedBehavior || '(none)'}
                            {f.expectedToolCalls.length > 0 ? ` · expected tools: ${f.expectedToolCalls.join(', ')}` : ''}
                          </p>
                          {diagnosisByCaseId.has(f.caseId) ? (
                            <DiagnosisLine diagnosis={diagnosisByCaseId.get(f.caseId)!} />
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {benchmarks.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
              {benchmarks.map((b) => (
                <Badge key={b.suiteId} color="zinc">
                  {b.suiteName}: {b.lastRun ? `${Math.round(b.lastRun.score * 10) / 10} / 100` : 'never run'}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>
      </AgentSectionCard>

      {/* ------------------------------------------------------------------ */}
      {/* 2. Proposal — the model's root-cause analysis + manifest diff.      */}
      {/* ------------------------------------------------------------------ */}
      {proposal ? (
        <AgentSectionCard
          title="Improvement proposal"
          description={
            <span>
              Generated {formatTimestamp(proposal.createdAt)} · analysis cost ${proposal.costUsd.toFixed(4)} · status{' '}
              <Badge color={proposal.status === 'rejected' ? 'zinc' : 'accent'}>{proposal.status}</Badge>
            </span>
          }
          actions={
            proposal.status === 'proposed' ? (
              <div className="flex items-center gap-2">
                <Button outline onClick={() => setConfirming('rejected')} disabled={creatingV2 || deciding !== null}>
                  Reject
                </Button>
                <Button color="accent" onClick={handleCreateV2} disabled={creatingV2}>
                  {creatingV2 ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="size-4" /> Creating V2…
                    </span>
                  ) : (
                    'Create V2 draft'
                  )}
                </Button>
              </div>
            ) : null
          }
        >
          <div className="space-y-5">
            {v2Error ? <ErrorBanner message={v2Error} /> : null}
            <Text>{proposal.summary}</Text>
            <SourceBadges sources={proposal.sources} />

            {proposal.failureAnalysis.length > 0 ? (
              <div>
                <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Root causes</p>
                <ul className="mt-3 divide-y divide-white/5 border-t border-white/5">
                  {proposal.failureAnalysis.map((f) => (
                    <li key={f.caseName} className="py-3 first:pt-3">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-zinc-950 dark:text-white">
                        {f.caseName}
                        {f.category ? (
                          <Badge color={f.recommendedFixType === 'graph_runtime_patch' ? 'accent' : 'zinc'}>{f.category}</Badge>
                        ) : null}
                      </p>
                      <p className="mt-1 text-xs break-words text-zinc-600 dark:text-zinc-400">{f.rootCause}</p>
                      {f.evidence ? <p className="mt-1 text-xs break-words text-zinc-500">evidence: {f.evidence}</p> : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Manifest changes (V1 → V2)</p>
              <ul className="mt-3 divide-y divide-white/5 border-t border-white/5">
                {changeEntries.map(([field, change]) => (
                  <li key={field} className="border-l-2 border-[var(--accent-line)] py-3 pl-3 first:pt-3">
                    <p className="text-sm font-medium text-zinc-950 dark:text-white">{CHANGE_FIELD_LABELS[field]}</p>
                    <p className="mt-1.5 text-xs break-words text-zinc-500 line-through decoration-zinc-400/60">
                      {renderValue(change.from)}
                    </p>
                    <p className="mt-1 text-xs break-words text-zinc-800 dark:text-zinc-200">{renderValue(change.to)}</p>
                    {change.why ? <p className="mt-1.5 text-xs break-words text-zinc-500">why: {change.why}</p> : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </AgentSectionCard>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* 3. V2 draft + re-runs — real suites pinned to the V2 versionId.     */}
      {/* ------------------------------------------------------------------ */}
      {proposal && proposal.v2VersionId ? (
        <AgentSectionCard
          title={`V2 draft — ${v2Version?.label ?? proposal.v2VersionId}`}
          description="The V2 behaviour is live on the copilot's LangGraph assistant. Re-run each suite pinned to the V2 version, then compare."
        >
          <div className="space-y-4">
            {rerunError ? <ErrorBanner message={rerunError} /> : null}
            {atRerunStep ? (
              <p className="text-xs font-medium tracking-wide text-accent-700 uppercase dark:text-accent-300">
                This step — re-run the suites on V2
              </p>
            ) : null}
            <div className="flex flex-wrap items-center gap-2">
              {suites.map((s, i) => {
                // Promote the first test re-run to solid accent while re-running
                // is the step's job; keep the rest outline so one clear primary
                // reads as THE action, not a wall of equal buttons.
                const primary = atRerunStep && i === 0
                const label =
                  rerunning === `test:${s.suiteId}` ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="size-4" /> Running {s.suiteName}…
                    </span>
                  ) : (
                    `Re-run tests: ${s.suiteName}`
                  )
                return primary ? (
                  <Button key={s.suiteId} color="accent" onClick={() => handleRerunTests(s.suiteId)} disabled={rerunning !== null}>
                    {label}
                  </Button>
                ) : (
                  <Button key={s.suiteId} outline onClick={() => handleRerunTests(s.suiteId)} disabled={rerunning !== null}>
                    {label}
                  </Button>
                )
              })}
              {benchmarks.map((b) => (
                <Button key={b.suiteId} outline onClick={() => handleRerunBenchmark(b.suiteId)} disabled={rerunning !== null}>
                  {rerunning === `bench:${b.suiteId}` ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="size-4" /> Running {b.suiteName}…
                    </span>
                  ) : (
                    `Re-run benchmark: ${b.suiteName}`
                  )}
                </Button>
              ))}
            </div>
            {rerunning ? (
              <Text>Real suite in progress against the Agent Server — each case runs the live graph, then a judge grades it.</Text>
            ) : atRerunStep ? (
              <Text>No V2 result yet — a re-run must finish before you can approve or reject the cycle below.</Text>
            ) : null}
          </div>
        </AgentSectionCard>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* 4. V1 vs V2 — recomputed live from test_runs / benchmark_runs.      */}
      {/* ------------------------------------------------------------------ */}
      {comparison ? (
        <AgentSectionCard
          title="V1 vs V2"
          description="Latest completed run per suite and per version — recomputed from the database, never cached on the proposal."
          contentClassName="px-6 py-4"
        >
          {/* Parent AgentSectionCard content already has px-6 — gutter 0 (no bleed)
              keeps header + body columns aligned to the card edge. */}
          <Table dense className="[--gutter:--spacing(0)]">
            <TableHead>
              <TableRow>
                <TableHeader>Suite</TableHeader>
                <TableHeader>{baseVersion.label} (V1)</TableHeader>
                <TableHeader>{v2Version?.label ?? 'V2'}</TableHeader>
                <TableHeader>Delta</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {comparison.tests.map((t) => (
                <TableRow key={t.suiteId}>
                  <TableCell className="font-medium">{t.suiteName}</TableCell>
                  <TableCell>{t.v1 ? `${formatPercent(t.v1.passRate)} pass` : '—'}</TableCell>
                  <TableCell>{t.v2 ? `${formatPercent(t.v2.passRate)} pass` : 'not re-run yet'}</TableCell>
                  <TableCell>
                    <DeltaText v1={t.v1?.passRate ?? null} v2={t.v2?.passRate ?? null} unit="pct" />
                  </TableCell>
                </TableRow>
              ))}
              {comparison.benchmarks.map((b) => (
                <TableRow key={b.suiteId}>
                  <TableCell className="font-medium">{b.suiteName} (benchmark)</TableCell>
                  <TableCell>{b.v1 ? `${Math.round(b.v1.score * 10) / 10} / 100` : '—'}</TableCell>
                  <TableCell>{b.v2 ? `${Math.round(b.v2.score * 10) / 10} / 100` : 'not re-run yet'}</TableCell>
                  <TableCell>
                    <DeltaText v1={b.v1?.score ?? null} v2={b.v2?.score ?? null} unit="pts" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </AgentSectionCard>
      ) : null}

      {/* ------------------------------------------------------------------ */}
      {/* 5. Human gate — approve/reject the cycle. Promotion stays manual.   */}
      {/* ------------------------------------------------------------------ */}
      {proposal ? (
        <AgentSectionCard
          title="Human decision"
          description="The loop never promotes anything on its own: approving records your verdict on this cycle; production promotion remains a separate manual act on the Release tab."
          actions={
            proposal.status === 'v2-created' ? (
              <div className="flex items-center gap-2">
                <Button outline onClick={() => setConfirming('rejected')} disabled={deciding !== null || rerunning !== null}>
                  {deciding === 'rejected' ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="size-4" /> Rejecting…
                    </span>
                  ) : (
                    'Reject V2'
                  )}
                </Button>
                <Button color="accent" onClick={() => setConfirming('approved')} disabled={deciding !== null || !hasV2Results || rerunning !== null}>
                  {deciding === 'approved' ? (
                    <span className="inline-flex items-center gap-2">
                      <Spinner className="size-4" /> Approving…
                    </span>
                  ) : (
                    'Approve V2'
                  )}
                </Button>
              </div>
            ) : null
          }
        >
          <div className="space-y-3">
            {decisionError ? <ErrorBanner message={decisionError} /> : null}
            {/* Never a mute disabled button: say WHY approve/reject is greyed out,
                highest-priority cause first (a run in flight, else no evidence). */}
            {proposal.status === 'v2-created' && rerunning !== null ? (
              <Text>Approve and reject are paused while a re-run is in progress — wait for the current run to finish.</Text>
            ) : proposal.status === 'v2-created' && !hasV2Results ? (
              <Text>Approve unlocks after at least one V2 re-run exists — re-run the tests on V2 first, then decide on evidence.</Text>
            ) : null}
            {proposal.status === 'approved' || proposal.status === 'rejected' ? (
              <div className="flex flex-wrap items-center gap-3">
                <Badge color={proposal.status === 'approved' ? 'accent' : 'zinc'}>{proposal.status}</Badge>
                <Text>
                  by {proposal.decidedBy ?? 'operator'}
                  {proposal.decidedAt ? ` · ${formatTimestamp(proposal.decidedAt)}` : ''}
                </Text>
                {proposal.status === 'approved' ? (
                  <Button outline href={`/admin/agents/${copilotId}/versions`}>
                    Open Release tab to promote
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </AgentSectionCard>
      ) : null}

      {/* Confirmation dialog — approving/rejecting a cycle is final. */}
      <Alert open={confirming !== null} onClose={() => setConfirming(null)}>
        <AlertTitle>
          {confirming === 'approved' ? 'Approve this improvement cycle?' : 'Reject this improvement cycle?'}
        </AlertTitle>
        <AlertDescription>
          {confirming === 'approved'
            ? 'This records your approval of the V2 draft. It does NOT promote it to production — that stays a separate manual act on the Release tab.'
            : 'This closes the cycle as rejected. The V2 draft rows stay for audit; a new analysis can be started afterwards.'}
        </AlertDescription>
        <AlertActions>
          <Button plain onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button color="accent" onClick={() => (confirming ? handleDecide(confirming) : undefined)}>
            {confirming === 'approved' ? 'Approve' : 'Reject'}
          </Button>
        </AlertActions>
      </Alert>
    </div>
  )
}
