'use client'

import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import { formatPercent } from '@/lib/agent-mission-control/format'
import type {
  ImprovementManifestChanges,
  ImprovementProposal,
  ImprovementSources,
  VersionComparison,
} from '@/lib/agent-mission-control/improvement-loop'
import { EmptyState, ErrorState, Section, Unavailable } from './screen-primitives'

/**
 * Improve — the ONE UI entry point onto the real backend improvement loop
 * (`improvement-loop.ts`): analyze → (nothing-to-improve | proposal) →
 * create V2 draft → compare V1/V2 → human approve/reject.
 *
 * CLIENT COMPONENT (the console's second one, after the project builder):
 * every step here is an operator-triggered, possibly BILLED mutation against
 * the three existing routes. No new route is introduced.
 *
 * Doctrine enforced here, not decoration:
 *  - `analyze` and `create-v2` run a real gpt-5.4 completion server-side —
 *    both require an explicit confirm click before the fetch fires.
 *  - Promotion is OUT OF SCOPE. Approve only records the human decision on
 *    the proposal row (`decideProposal`); it never calls the promotion route.
 *  - A source that could not be read renders "Indisponible", never "0" and
 *    never a healthy dot — `sources.*Reason` carries the honest cause.
 *  - 409 (open cycle already exists, or proposal already decided) renders as
 *    a plain sentence, never a thrown error the boundary has to catch.
 *  - Every `setState` past an `await` is guarded by `mountedRef`, and each
 *    action is disabled while its own request is in flight — no double POST.
 */

type ActionError = { title: string; description?: string }

/** `analyze`'s 409 body carries `proposalId` — used to route straight to the
 *  existing open cycle instead of leaving the operator stuck on a dead end. */
type AnalyzeConflictBody = { error?: string; proposalId?: string }

function sourceTone(available: boolean): StatusDotTone {
  return available ? 'positive' : 'negative'
}

/**
 * One line per signal the analysis actually consulted. Runtime telemetry is
 * ALWAYS listed explicitly (never folded into "other sources") — it is the
 * signal that closes the "every test passes but production is failing" gap,
 * and it must be visible even when it was the one that came back empty.
 */
function SourcesList({ sources }: { sources: ImprovementSources }) {
  const rows: { label: string; available: boolean; reason?: string }[] = [
    { label: 'Database (tests, benchmarks, runs)', available: sources.db },
    { label: 'LangGraph thread detail', available: sources.langgraph, reason: sources.langgraphReason },
    { label: 'LangSmith traces', available: sources.langsmith, reason: sources.langsmithReason },
    {
      label: 'Deployed runtime telemetry',
      available: sources.runtimeTelemetry,
      reason: sources.runtimeTelemetryReason,
    },
  ]
  return (
    <ul className="space-y-1.5">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-3 text-[12px]/5">
          <span className="text-content-muted">{row.label}</span>
          {row.available ? (
            <StatusDot tone={sourceTone(true)}>available</StatusDot>
          ) : (
            <span className="flex items-center gap-1.5">
              <StatusDot tone={sourceTone(false)}>unavailable</StatusDot>
              {row.reason ? <span className="text-[11px]/4 text-content-faint">({row.reason})</span> : null}
            </span>
          )}
        </li>
      ))}
    </ul>
  )
}

/** One `from → to` manifest field change, with the model's stated reason. */
function ManifestChangeRow<T>({
  label,
  change,
  render,
}: {
  label: string
  change: { from: T; to: T; why: string } | undefined
  render: (v: T) => React.ReactNode
}) {
  if (!change) return null
  return (
    <div className="border-b border-line px-4 py-2.5 last:border-b-0">
      <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">{label}</p>
      <div className="mt-1 space-y-1 text-[12px]/5">
        <p className="text-content-subtle line-through decoration-graphite-700">{render(change.from)}</p>
        <p className="text-content">{render(change.to)}</p>
      </div>
      {change.why ? <p className="mt-1 text-[11px]/4 text-content-subtle">{change.why}</p> : null}
    </div>
  )
}

function ManifestChangesBlock({ changes }: { changes: ImprovementManifestChanges }) {
  const hasAny =
    changes.systemPromptSummary ||
    changes.forbiddenActions ||
    changes.alwaysConfirmActions ||
    changes.confirmationPolicy ||
    changes.maxStepsPerRun ||
    changes.outputContractInvariants
  if (!hasAny) {
    return (
      <EmptyState
        title="No manifest field changes were proposed."
        description="The failures found were not fixable by a manifest patch alone."
      />
    )
  }
  return (
    <div>
      <ManifestChangeRow label="System prompt summary" change={changes.systemPromptSummary} render={(v) => v} />
      <ManifestChangeRow
        label="Confirmation policy"
        change={changes.confirmationPolicy}
        render={(v) => v}
      />
      <ManifestChangeRow
        label="Max steps per run"
        change={changes.maxStepsPerRun}
        render={(v) => String(v)}
      />
      <ManifestChangeRow
        label="Forbidden actions"
        change={changes.forbiddenActions}
        render={(v) => (v.length > 0 ? v.join(', ') : '(none)')}
      />
      <ManifestChangeRow
        label="Always-confirm actions"
        change={changes.alwaysConfirmActions}
        render={(v) => (v.length > 0 ? v.join(', ') : '(none)')}
      />
      <ManifestChangeRow
        label="Output contract invariants"
        change={changes.outputContractInvariants}
        render={(v) => (v.length > 0 ? v.join(', ') : '(none)')}
      />
    </div>
  )
}

function ComparisonTable({ comparison, baseLabel, v2Label }: { comparison: VersionComparison; baseLabel: string; v2Label: string }) {
  if (comparison.tests.length === 0 && comparison.benchmarks.length === 0) {
    return <EmptyState title="No test or benchmark suite is configured for this copilot." />
  }
  return (
    <div className="space-y-4 px-4 py-3">
      {comparison.tests.length > 0 ? (
        <div>
          <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">Tests — pass rate</p>
          <div className="mt-1.5 space-y-1">
            {comparison.tests.map((t) => (
              <div key={t.suiteId} className="flex items-center justify-between text-[12px]/5">
                <span className="min-w-0 truncate text-content-muted">{t.suiteName}</span>
                <span className="tabular-nums text-content-muted">
                  {baseLabel}: {t.v1 === null ? <Unavailable /> : formatPercent(t.v1.passRate)}
                  {'  ·  '}
                  {v2Label}: {t.v2 === null ? <Unavailable /> : formatPercent(t.v2.passRate)}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {comparison.benchmarks.length > 0 ? (
        <div>
          <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">Benchmarks — score</p>
          <div className="mt-1.5 space-y-1">
            {comparison.benchmarks.map((b) => (
              <div key={b.suiteId} className="flex items-center justify-between text-[12px]/5">
                <span className="min-w-0 truncate text-content-muted">{b.suiteName}</span>
                <span className="tabular-nums text-content-muted">
                  {baseLabel}: {b.v1 === null ? <Unavailable /> : b.v1.score}
                  {'  ·  '}
                  {v2Label}: {b.v2 === null ? <Unavailable /> : b.v2.score}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ImprovePanel({
  copilotId,
  baseVersionLabel,
  initialProposal,
  initialComparison,
}: {
  copilotId: string
  /** The version the NEXT analysis would run against (production, else latest). */
  baseVersionLabel: string
  /** Seeded from the server resolver so a page reload shows the real cycle. */
  initialProposal: ImprovementProposal | null
  /**
   * V1-vs-V2 comparison, recomputed server-side (`compareImprovementVersions`)
   * at page-load time. There is no client route to re-fetch it after `create-v2`
   * materializes a fresh V2 (the mission's route allowlist has only analyze/
   * create-v2/decision) — a freshly created V2 has no test/benchmark runs yet
   * regardless, so the table would be empty either way. A reload of the page
   * picks up the comparison once runs exist.
   */
  initialComparison: VersionComparison | null
}) {
  const [proposal, setProposal] = useState<ImprovementProposal | null>(initialProposal)
  const [comparison] = useState<VersionComparison | null>(initialComparison)
  const [busy, setBusy] = useState<'analyze' | 'create-v2' | 'decision' | null>(null)
  const [error, setError] = useState<ActionError | null>(null)
  const [confirmingAnalyze, setConfirmingAnalyze] = useState(false)
  const [confirmingCreateV2, setConfirmingCreateV2] = useState(false)
  const [justCreatedV2, setJustCreatedV2] = useState(false)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  async function runAnalyze() {
    setConfirmingAnalyze(false)
    setBusy('analyze')
    setError(null)
    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/improve/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggeredBy: 'console-operator' }),
      })
      const payload = (await response.json()) as { ok?: true; proposal?: ImprovementProposal; error?: string } & AnalyzeConflictBody
      if (!mountedRef.current) return
      if (response.status === 409) {
        setError({
          title: 'An improvement cycle is already open for this copilot.',
          description: 'Decide the open proposal below before starting a new analysis.',
        })
        return
      }
      if (!response.ok || !payload.ok) {
        if (typeof payload.error === 'string' && payload.error.startsWith('nothing to improve:')) {
          setError({ title: 'Nothing to improve right now.', description: payload.error })
        } else {
          setError({ title: payload.error ?? 'Analysis failed.' })
        }
        return
      }
      setProposal(payload.proposal ?? null)
    } catch (reason) {
      if (!mountedRef.current) return
      setError({ title: reason instanceof Error ? reason.message : 'Analysis failed.' })
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  async function runCreateV2() {
    if (!proposal) return
    setConfirmingCreateV2(false)
    setBusy('create-v2')
    setError(null)
    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/improve/create-v2`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id }),
      })
      const payload = (await response.json()) as { ok?: true; v2VersionId?: string; error?: string }
      if (!mountedRef.current) return
      if (response.status === 409) {
        setError({ title: 'This proposal is no longer awaiting V2 creation.', description: payload.error })
        return
      }
      if (!response.ok || !payload.ok) {
        setError({ title: payload.error ?? 'V2 creation failed.' })
        return
      }
      setProposal((current) =>
        current
          ? { ...current, status: 'v2-created', v2VersionId: payload.v2VersionId ?? current.v2VersionId }
          : current
      )
      setJustCreatedV2(true)
    } catch (reason) {
      if (!mountedRef.current) return
      setError({ title: reason instanceof Error ? reason.message : 'V2 creation failed.' })
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  async function runDecision(decision: 'approved' | 'rejected') {
    if (!proposal) return
    setBusy('decision')
    setError(null)
    try {
      const response = await fetch(`/api/agent-ops/copilots/${copilotId}/improve/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposalId: proposal.id, decision, decidedBy: 'console-operator' }),
      })
      const payload = (await response.json()) as { ok?: true; error?: string }
      if (!mountedRef.current) return
      if (response.status === 409) {
        setError({ title: 'This proposal was already decided, or is not ready for approval yet.', description: payload.error })
        return
      }
      if (!response.ok || !payload.ok) {
        setError({ title: payload.error ?? 'Decision failed.' })
        return
      }
      setProposal((current) => (current ? { ...current, status: decision } : current))
    } catch (reason) {
      if (!mountedRef.current) return
      setError({ title: reason instanceof Error ? reason.message : 'Decision failed.' })
    } finally {
      if (mountedRef.current) setBusy(null)
    }
  }

  const cycleOpen = proposal !== null && (proposal.status === 'proposed' || proposal.status === 'v2-created')
  const decided = proposal !== null && (proposal.status === 'approved' || proposal.status === 'rejected')

  return (
    <Section
      title="Improve"
      description="Analyze real signals, propose a V2 draft, compare, then decide — production promotion stays a separate, human-triggered step"
      scroll="lg"
    >
      {error ? (
        <div className="border-b border-line p-3">
          <ErrorState title={error.title} description={error.description} />
        </div>
      ) : null}

      {proposal === null ? (
        <div className="p-4">
          <EmptyState
            title="No improvement cycle has been run for this copilot."
            description={`Analysis reasons over ${baseVersionLabel} using real test, benchmark, run and telemetry signals.`}
          />
          <div className="mt-3 flex justify-center">
            {confirmingAnalyze ? (
              <div className="flex items-center gap-2">
                <span className="text-[11px]/4 text-content-subtle">This runs a billed gpt-5.4 completion.</span>
                <Button outline onClick={() => setConfirmingAnalyze(false)} disabled={busy === 'analyze'}>
                  Cancel
                </Button>
                <Button color="accent" onClick={() => void runAnalyze()} disabled={busy === 'analyze'}>
                  Confirm analyze
                </Button>
              </div>
            ) : (
              <Button color="accent" onClick={() => setConfirmingAnalyze(true)} disabled={busy !== null}>
                Analyze
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div>
          <div className="border-b border-line px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <StatusDot tone={decided ? (proposal.status === 'approved' ? 'positive' : 'negative') : 'pending'}>
                {proposal.status}
              </StatusDot>
              {!cycleOpen && !decided ? null : (
                <span className="text-[11px]/4 text-content-subtle">
                  {proposal.baseVersionId} → {proposal.v2VersionId ?? 'no V2 yet'}
                </span>
              )}
            </div>
            {proposal.summary ? <p className="mt-2 text-[12px]/5 text-content-muted">{proposal.summary}</p> : null}
          </div>

          <div className="border-b border-line px-4 py-3">
            <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">Sources consulted</p>
            <div className="mt-2">
              <SourcesList sources={proposal.sources} />
            </div>
          </div>

          <div className="border-b border-line">
            <p className="px-4 pt-3 text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
              Proposed manifest changes
            </p>
            <ManifestChangesBlock changes={proposal.manifestChanges} />
          </div>

          {proposal.v2VersionId ? (
            <div className="border-b border-line">
              <p className="px-4 pt-3 text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">
                Base version vs V2 draft
              </p>
              {comparison ? (
                <ComparisonTable comparison={comparison} baseLabel="base" v2Label="V2" />
              ) : justCreatedV2 ? (
                <EmptyState
                  title="V2 draft created — no comparable runs yet."
                  description="Reload this page once tests or benchmarks have run against the V2 draft to see the comparison."
                />
              ) : (
                <div className="px-4 py-3">
                  <Unavailable className="text-[11px]/5" />
                </div>
              )}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-end gap-2 p-3">
            {proposal.status === 'proposed' ? (
              confirmingCreateV2 ? (
                <>
                  <span className="text-[11px]/4 text-content-subtle">This runs a billed gpt-5.4 completion.</span>
                  <Button outline onClick={() => setConfirmingCreateV2(false)} disabled={busy === 'create-v2'}>
                    Cancel
                  </Button>
                  <Button color="accent" onClick={() => void runCreateV2()} disabled={busy === 'create-v2'}>
                    Confirm create V2
                  </Button>
                </>
              ) : (
                <Button color="accent" onClick={() => setConfirmingCreateV2(true)} disabled={busy !== null}>
                  Create V2 draft
                </Button>
              )
            ) : null}
            {proposal.status === 'v2-created' ? (
              <>
                <Button outline onClick={() => void runDecision('rejected')} disabled={busy !== null}>
                  Reject
                </Button>
                <Button color="accent" onClick={() => void runDecision('approved')} disabled={busy !== null}>
                  Approve
                </Button>
              </>
            ) : null}
            {decided ? (
              <Button outline onClick={() => setConfirmingAnalyze(true)} disabled={busy !== null}>
                Start a new cycle
              </Button>
            ) : null}
            {decided && confirmingAnalyze ? (
              <>
                <span className="text-[11px]/4 text-content-subtle">This runs a billed gpt-5.4 completion.</span>
                <Button outline onClick={() => setConfirmingAnalyze(false)} disabled={busy === 'analyze'}>
                  Cancel
                </Button>
                <Button color="accent" onClick={() => void runAnalyze()} disabled={busy === 'analyze'}>
                  Confirm analyze
                </Button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </Section>
  )
}
