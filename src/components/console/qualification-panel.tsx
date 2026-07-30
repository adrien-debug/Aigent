'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { EmptyState, Section } from './screen-primitives'

/**
 * Qualification · Shadow · Replay — the one client panel on the agent detail
 * screen that can DRIVE the real workflow (`qualification-orchestrator.ts`)
 * and the real shadow/replay engines, rather than only read them.
 *
 * REUSES existing routes only, verbatim contracts:
 *   - GET/POST /api/agent-ops/copilots/:copilotId/qualification
 *   - POST     /api/agent-ops/copilots/:copilotId/versions/:versionId/shadow
 *   - POST     /api/agent-ops/copilots/:copilotId/versions/:versionId/replay
 *
 * No engine is touched here. This panel only renders what those routes
 * already answer and lets an operator trigger them with an explicit
 * confirmation step first — these are costed, real LangGraph executions.
 *
 * TARGETED VERSION is passed in from the server-resolved `AgentDetail`
 * (`currentVersion`), never re-derived client-side. When there is no
 * candidate version the actions are disabled with a stated reason instead of
 * silently vanishing — a dead button is worse than an explained one, but a
 * LIVE button pointed at nothing is worse still.
 */

type StepStatus =
  | 'PASS'
  | 'FAIL'
  | 'NOT_CONFIGURED'
  | 'NOT_AVAILABLE'
  | 'INSUFFICIENT_EVIDENCE'
  | 'PENDING'

interface QualificationStepResult {
  step: 'tests' | 'benchmark' | 'shadow' | 'replay' | 'gate'
  status: StepStatus
  reason: string
  evidenceRef: string | null
  sourceOfTruth: string
  at: string
}

interface QualificationReadiness {
  state: 'running' | 'blocked' | 'promotable' | 'superseded' | 'aborted' | 'not_started'
  promotable: boolean
  nextAction: string
  blockers: string[]
  candidateVersionId: string | null
  runId: string | null
  steps: QualificationStepResult[]
}

interface ShadowExperiment {
  id: string
  status: 'queued' | 'running' | 'completed' | 'stopped' | 'failed'
  verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT_EVIDENCE' | null
  executionMode: 'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown'
  sampledRunCount: number
  wouldMutateCount: number
  startedAt: string
  endsAt: string | null
}

interface ReplayComparison {
  id: string
  status: 'draft' | 'queued' | 'running' | 'ready' | 'diverged' | 'matched' | 'failed'
  verdict: 'BETTER' | 'EQUIVALENT' | 'WORSE' | 'INCONCLUSIVE' | null
  executionMode: 'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown'
  caseCount: number
  createdAt: string
}

/** Three real, distinguishable outcomes plus "never run" — never collapsed into one pill. */
type EvidenceState = 'unavailable' | 'blocked' | 'failed' | 'completed' | 'pending'

function shadowEvidenceState(exp: ShadowExperiment | null): EvidenceState {
  if (exp === null) return 'unavailable'
  if (exp.status === 'queued' || exp.status === 'running') return 'pending'
  if (exp.status === 'stopped' || exp.status === 'failed') return 'failed'
  // completed: verdict decides blocked vs completed. would-mutate breaches or a
  // FAIL verdict are a BLOCK on the candidate, not a pipeline failure.
  if (exp.verdict === 'FAIL' || exp.wouldMutateCount > 0) return 'blocked'
  if (exp.verdict === 'PASS') return 'completed'
  return 'blocked' // INSUFFICIENT_EVIDENCE or null verdict on a completed row: not proven safe
}

function replayEvidenceState(cmp: ReplayComparison | null): EvidenceState {
  if (cmp === null) return 'unavailable'
  if (cmp.status === 'queued' || cmp.status === 'running') return 'pending'
  if (cmp.status === 'failed' || cmp.status === 'diverged') return 'failed'
  if (cmp.verdict === 'WORSE') return 'blocked'
  if (cmp.verdict === 'BETTER' || cmp.verdict === 'EQUIVALENT') return 'completed'
  return 'blocked' // INCONCLUSIVE or missing verdict on a settled row
}

const EVIDENCE_LABEL: Record<EvidenceState, string> = {
  unavailable: 'Not run',
  blocked: 'Blocked',
  failed: 'Failed',
  completed: 'Completed',
  pending: 'Running',
}

const EVIDENCE_TONE: Record<EvidenceState, StatusDotTone> = {
  unavailable: 'neutral',
  blocked: 'negative',
  failed: 'negative',
  completed: 'positive',
  pending: 'pending',
}

const STEP_STATUS_TONE: Record<StepStatus, StatusDotTone> = {
  PASS: 'positive',
  FAIL: 'negative',
  NOT_CONFIGURED: 'neutral',
  NOT_AVAILABLE: 'neutral',
  INSUFFICIENT_EVIDENCE: 'negative',
  PENDING: 'pending',
}

function formatWhen(iso: string | null): string {
  if (iso === null) return ''
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  return new Date(t).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'
}

/** One action button that requires an explicit second click to actually fire —
 *  these are costed, real executions, never a one-click accident. */
function ConfirmButton({
  label,
  confirmLabel,
  disabled,
  disabledReason,
  busy,
  onConfirm,
}: {
  label: string
  confirmLabel: string
  disabled: boolean
  disabledReason: string | null
  busy: boolean
  onConfirm: () => void
}) {
  const [armed, setArmed] = useState(false)

  if (disabled) {
    return (
      <div className="flex flex-col items-start gap-1">
        <Button outline disabled>
          {label}
        </Button>
        {disabledReason ? <p className="text-[11px]/4 text-content-subtle">{disabledReason}</p> : null}
      </div>
    )
  }

  if (armed) {
    return (
      <div className="flex items-center gap-2">
        <Button
          color="danger"
          disabled={busy}
          onClick={() => {
            setArmed(false)
            onConfirm()
          }}
        >
          {busy ? 'Running…' : confirmLabel}
        </Button>
        <Button plain disabled={busy} onClick={() => setArmed(false)}>
          Cancel
        </Button>
      </div>
    )
  }

  return (
    <Button outline disabled={busy} onClick={() => setArmed(true)}>
      {label}
    </Button>
  )
}

export function QualificationPanel({
  copilotId,
  candidateVersionId,
  candidateVersionLabel,
  candidateVersionStage,
}: {
  copilotId: string
  /** The version this panel targets — server-resolved, never re-derived here. */
  candidateVersionId: string | null
  candidateVersionLabel: string | null
  candidateVersionStage: string | null
}) {
  const [readiness, setReadiness] = useState<QualificationReadiness | null>(null)
  const [shadow, setShadow] = useState<ShadowExperiment | null | 'unread'>('unread')
  const [replay, setReplay] = useState<ReplayComparison | null | 'unread'>('unread')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busyAction, setBusyAction] = useState<'qualify' | 'shadow' | 'replay' | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const mountedRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [])

  const load = useCallback(
    async (signal: AbortSignal) => {
      if (!candidateVersionId) {
        setLoading(false)
        return
      }
      setLoading(true)
      setLoadError(null)
      try {
        const [qualRes, shadowRes, replayRes] = await Promise.all([
          fetch(`/api/agent-ops/copilots/${copilotId}/qualification?versionId=${candidateVersionId}`, { signal }),
          fetch(`/api/agent-ops/copilots/${copilotId}/versions/${candidateVersionId}/shadow`, { signal }),
          fetch(`/api/agent-ops/copilots/${copilotId}/versions/${candidateVersionId}/replay`, { signal }),
        ])
        if (!mountedRef.current || signal.aborted) return

        if (qualRes.ok) {
          const body = (await qualRes.json()) as { readiness: QualificationReadiness }
          if (!mountedRef.current || signal.aborted) return
          setReadiness(body.readiness)
        } else if (qualRes.status !== 404) {
          throw new Error(`qualification read failed (${qualRes.status})`)
        }

        if (shadowRes.ok) {
          const body = (await shadowRes.json()) as { experiment: ShadowExperiment | null }
          if (!mountedRef.current || signal.aborted) return
          setShadow(body.experiment)
        } else {
          setShadow(null)
        }

        if (replayRes.ok) {
          const body = (await replayRes.json()) as { comparison: ReplayComparison | null }
          if (!mountedRef.current || signal.aborted) return
          setReplay(body.comparison)
        } else {
          setReplay(null)
        }
      } catch (err) {
        if (!mountedRef.current || signal.aborted) return
        setLoadError(err instanceof Error ? err.message : 'Failed to load qualification evidence.')
      } finally {
        if (mountedRef.current && !signal.aborted) setLoading(false)
      }
    },
    [copilotId, candidateVersionId],
  )

  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    // Deferred a microtask: `load()`'s first statement is a synchronous
    // `setState`, and calling it directly in the effect body risks a
    // cascading render (react-hooks/set-state-in-effect). `Promise.resolve()`
    // pushes that first `setState` past this render's commit without
    // changing the abort/mount-guard contract below.
    void Promise.resolve().then(() => load(controller.signal))
    return () => controller.abort()
  }, [load])

  async function runQualification() {
    if (!candidateVersionId || busyAction) return
    setBusyAction('qualify')
    setActionError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/qualification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: candidateVersionId, action: 'sweep' }),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `qualification sweep failed (${res.status})`)
      }
      const body = (await res.json()) as { readiness: QualificationReadiness }
      if (!mountedRef.current) return
      setReadiness(body.readiness)
    } catch (err) {
      if (!mountedRef.current) return
      setActionError(err instanceof Error ? err.message : 'Qualification sweep failed.')
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function runShadow() {
    if (!candidateVersionId || busyAction) return
    setBusyAction('shadow')
    setActionError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/versions/${candidateVersionId}/shadow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useFixture: false }),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `shadow run failed (${res.status})`)
      }
      const refreshController = new AbortController()
      abortRef.current?.abort()
      abortRef.current = refreshController
      await load(refreshController.signal)
    } catch (err) {
      if (!mountedRef.current) return
      setActionError(err instanceof Error ? err.message : 'Shadow run failed.')
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  async function runReplay() {
    if (!candidateVersionId || busyAction) return
    setBusyAction('replay')
    setActionError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilotId}/versions/${candidateVersionId}/replay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ useFixture: false }),
      })
      if (!mountedRef.current) return
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `replay run failed (${res.status})`)
      }
      const refreshController = new AbortController()
      abortRef.current?.abort()
      abortRef.current = refreshController
      await load(refreshController.signal)
    } catch (err) {
      if (!mountedRef.current) return
      setActionError(err instanceof Error ? err.message : 'Replay run failed.')
    } finally {
      if (mountedRef.current) setBusyAction(null)
    }
  }

  const noCandidate = !candidateVersionId
  const disabledReason = noCandidate
    ? 'No draft/beta candidate version exists for this agent — nothing to qualify.'
    : null

  return (
    <Section
      title="Qualification · Shadow · Replay"
      description={
        noCandidate
          ? 'No candidate version to qualify'
          : `Targets version ${candidateVersionLabel ?? candidateVersionId} (${candidateVersionStage ?? 'unknown stage'})`
      }
      scroll="lg"
    >
      {noCandidate ? (
        <EmptyState
          title="No candidate version."
          description="Qualification, Shadow and Replay all require a draft or beta version to target."
        />
      ) : (
        <div className="space-y-4 px-4 py-3">
          {loadError ? (
            <p className="text-[12px]/5 text-[var(--state-danger-text)]">
              Evidence could not be loaded: {loadError}
            </p>
          ) : null}
          {actionError ? (
            <p className="text-[12px]/5 text-[var(--state-danger-text)]">{actionError}</p>
          ) : null}

          {/* ── Qualification workflow ─────────────────────────────────── */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Qualification workflow
              </p>
              <ConfirmButton
                label="Run qualification"
                confirmLabel="Confirm — run now"
                disabled={busyAction !== null && busyAction !== 'qualify'}
                disabledReason={null}
                busy={busyAction === 'qualify'}
                onConfirm={() => void runQualification()}
              />
            </div>
            {loading ? (
              <p className="text-[12px]/5 text-content-subtle">Loading…</p>
            ) : readiness === null ? (
              <p className="text-[12px]/5 text-content-subtle">Not started.</p>
            ) : (
              <>
                <StatusDot
                  tone={
                    readiness.state === 'promotable'
                      ? 'positive'
                      : readiness.state === 'running'
                        ? 'pending'
                        : readiness.state === 'not_started'
                          ? 'neutral'
                          : 'negative'
                  }
                >
                  {readiness.state}
                </StatusDot>
                <p className="text-[12px]/5 text-content-muted">{readiness.nextAction}</p>
                {readiness.steps.length > 0 ? (
                  <ul className="space-y-1">
                    {readiness.steps.map((s, i) => (
                      <li key={`${s.step}-${i}`} className="flex items-center gap-2 text-[11px]/5">
                        <StatusDot tone={STEP_STATUS_TONE[s.status]} className="max-w-28">
                          {s.step}
                        </StatusDot>
                        <span className="text-content-subtle">{s.reason}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            )}
          </div>

          {/* ── Shadow ──────────────────────────────────────────────────── */}
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Shadow
              </p>
              <ConfirmButton
                label="Run shadow"
                confirmLabel="Confirm — launch live shadow"
                disabled={busyAction !== null && busyAction !== 'shadow'}
                disabledReason={disabledReason}
                busy={busyAction === 'shadow'}
                onConfirm={() => void runShadow()}
              />
            </div>
            {loading ? (
              <p className="text-[12px]/5 text-content-subtle">Loading…</p>
            ) : shadow === 'unread' || shadow === null ? (
              <StatusDot tone="neutral">Not run</StatusDot>
            ) : (
              <>
                <StatusDot tone={EVIDENCE_TONE[shadowEvidenceState(shadow)]}>
                  {EVIDENCE_LABEL[shadowEvidenceState(shadow)]}
                </StatusDot>
                <dl className="mt-1 space-y-0.5 text-[11px]/5 text-content-muted">
                  <div>
                    Provenance:{' '}
                    <span className={shadow.executionMode === 'live_langgraph' ? 'text-content-muted' : 'text-amber-400'}>
                      {shadow.executionMode === 'deterministic_fixture'
                        ? 'simulated ($0 fixture — never gates a real promotion)'
                        : shadow.executionMode}
                    </span>
                  </div>
                  <div>Sampled runs: {shadow.sampledRunCount}</div>
                  <div>
                    Mutations blocked:{' '}
                    <span className={shadow.wouldMutateCount > 0 ? 'text-[var(--state-danger-text)]' : 'text-content-muted'}>
                      {shadow.wouldMutateCount}
                    </span>
                  </div>
                  {shadow.endsAt ? <div>Finished: {formatWhen(shadow.endsAt)}</div> : null}
                </dl>
              </>
            )}
          </div>

          {/* ── Replay ──────────────────────────────────────────────────── */}
          <div className="space-y-2 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Replay
              </p>
              <ConfirmButton
                label="Run replay"
                confirmLabel="Confirm — launch live replay"
                disabled={busyAction !== null && busyAction !== 'replay'}
                disabledReason={disabledReason}
                busy={busyAction === 'replay'}
                onConfirm={() => void runReplay()}
              />
            </div>
            {loading ? (
              <p className="text-[12px]/5 text-content-subtle">Loading…</p>
            ) : replay === 'unread' || replay === null ? (
              <StatusDot tone="neutral">Not run</StatusDot>
            ) : (
              <>
                <StatusDot tone={EVIDENCE_TONE[replayEvidenceState(replay)]}>
                  {EVIDENCE_LABEL[replayEvidenceState(replay)]}
                </StatusDot>
                <dl className="mt-1 space-y-0.5 text-[11px]/5 text-content-muted">
                  <div>
                    Provenance:{' '}
                    <span className={replay.executionMode === 'live_langgraph' ? 'text-content-muted' : 'text-amber-400'}>
                      {replay.executionMode === 'deterministic_fixture'
                        ? 'simulated ($0 fixture — never gates a real promotion)'
                        : replay.executionMode}
                    </span>
                  </div>
                  <div>Cases compared: {replay.caseCount}</div>
                  <div>Created: {formatWhen(replay.createdAt)}</div>
                </dl>
              </>
            )}
          </div>
        </div>
      )}
    </Section>
  )
}
