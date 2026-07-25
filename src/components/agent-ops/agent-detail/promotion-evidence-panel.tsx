'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { Text } from '@/components/catalyst/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { PromotionCheck, PromotionCheckStatus } from '@/lib/agent-mission-control/promotion-gate'

/**
 * Promotion evidence — the extended promotion gate (release-gate rollup +
 * runtime-executable + tools-resolved-certified + shadow-proof +
 * replay-comparison), read-only.
 *
 * This is NOT a second cockpit: it renders exactly what
 * `evaluatePromotionGate` already computed for the "Promote or roll back"
 * section below it, adding no verdict of its own and no second Promote
 * button. `ReleaseActions` derives `canPromote` purely from the `promote`
 * Capability + candidateVersionId it already receives — it exposes no
 * external override prop to wire a second gate into, so adding an actionable
 * control here would either duplicate the real one or risk disagreeing with
 * it. Evidence only.
 */

const STATUS_LABEL: Record<PromotionCheckStatus, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  NOT_CONFIGURED: 'Not configured',
  INSUFFICIENT_EVIDENCE: 'Not measured',
}

/** Same honest-text convention as `CheckStatusText` in release-panel.tsx: the
 * word carries the distinction, the accent dot marks PASS only, and a FAIL
 * is never painted the same as an unmeasured check. */
function PromotionStatusText({ status }: { status: PromotionCheckStatus }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={
          status === 'PASS'
            ? 'size-1.5 rounded-full bg-accent-500'
            : status === 'FAIL'
              ? 'size-1.5 rounded-full bg-[var(--state-danger-solid)]'
              : 'size-1.5 rounded-full ring-1 ring-zinc-400 dark:ring-zinc-500'
        }
      />
      <span
        className={
          status === 'PASS'
            ? 'text-accent-700 dark:text-accent-300'
            : status === 'FAIL'
              ? 'text-[var(--state-danger-text)]'
              : 'text-zinc-500 dark:text-zinc-400'
        }
      >
        {STATUS_LABEL[status]}
      </span>
    </span>
  )
}

/**
 * Provenance of a shadow/replay row (migration 0034, PR #22 rework) — the
 * exact vocabulary `promotion-gate.ts`'s shadowCheck/replayCheck use to
 * decide whether a REQUIRED check can be satisfied. `live_langgraph` is the
 * only value that can. This badge is deliberately loud (not a quiet caption)
 * because the entire rework exists to prevent a reader from mistaking
 * `deterministic_fixture` evidence for a production proof.
 */
type ExecutionMode = 'live_langgraph' | 'deterministic_fixture' | 'legacy_unknown'

function ExecutionModeBadge({ mode }: { mode: ExecutionMode | string }) {
  const isLive = mode === 'live_langgraph'
  const label = isLive ? 'Live LangGraph run' : mode === 'deterministic_fixture' ? 'Deterministic fixture ($0 simulation)' : 'Provenance unrecorded'
  return (
    <span
      className={
        isLive
          ? 'inline-flex items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-medium text-accent-700 ring-1 ring-inset ring-[var(--accent-line)] dark:text-accent-300'
          : 'inline-flex items-center gap-1.5 rounded-full bg-[var(--state-danger-soft)] px-2.5 py-1 text-xs font-medium text-[var(--state-danger-text)] ring-1 ring-inset ring-[var(--state-danger-line)]'
      }
    >
      <span aria-hidden="true" className={isLive ? 'size-1.5 rounded-full bg-accent-500' : 'size-1.5 rounded-full bg-[var(--state-danger-solid)]'} />
      {label}
    </span>
  )
}

/** The five promotion checks, each with its own real `reason` — never a
 * generic message when the check already produced one. */
export function PromotionChecksList({ checks }: { checks: PromotionCheck[] }) {
  return (
    <ul className="flex max-h-72 flex-col overflow-y-auto">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2.5 last:border-0"
        >
          <div className="min-w-0">
            <span className="text-sm text-zinc-200">{check.label}</span>
            <p className="mt-0.5 text-xs text-zinc-400">{check.reason}</p>
            <p className="mt-0.5 text-[10px] text-zinc-500">{check.sourceOfTruth}</p>
          </div>
          <PromotionStatusText status={check.status} />
        </li>
      ))}
    </ul>
  )
}

/** Shadow experiment evidence — always framed as a simulation, never "LIVE". */
export function ShadowEvidence({
  shadow,
}: {
  shadow: {
    status: string
    candidateVerdict: string | null
    wouldMutateCount: number
    sampledRunCount: number
    executionMode: string
  } | null
}) {
  if (!shadow) {
    return (
      <EmptyState
        title="No shadow experiment"
        description="No shadow run has been recorded for this candidate. This is not a failure — nobody has run the simulation yet."
      />
    )
  }
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="col-span-2 sm:col-span-4">
        <dt className={eyebrowClass}>Provenance</dt>
        <dd className="mt-1">
          <ExecutionModeBadge mode={shadow.executionMode} />
        </dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Status</dt>
        <dd className="mt-1 text-sm text-zinc-200">{shadow.status}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Verdict</dt>
        <dd className="mt-1 text-sm text-zinc-200">{shadow.candidateVerdict ?? '—'}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Sampled runs</dt>
        <dd className="mt-1 font-mono text-sm tabular-nums text-white">{shadow.sampledRunCount}</dd>
      </div>
      <div>
        <dt className={eyebrowClass}>Would-mutate breaches</dt>
        <dd className="mt-1 font-mono text-sm tabular-nums text-white">{shadow.wouldMutateCount}</dd>
      </div>
      <div className="col-span-2 sm:col-span-4">
        <Text className="!mt-0 !text-xs">
          {shadow.executionMode === 'live_langgraph'
            ? 'A shadow run replays traffic against the candidate without serving it — nothing here was shown to a real consumer.'
            : 'This is a deterministic $0 simulation proving the shadow machinery (the mutating-tool block, the evidence path) — it did NOT exercise the candidate’s real behavior, and cannot satisfy a required shadow-proof promotion check.'}
        </Text>
      </div>
    </dl>
  )
}

/** Replay comparison evidence — verdict, case count, and the divergent cases only. */
export function ReplayEvidence({
  replay,
}: {
  replay: {
    verdict: string | null
    caseCount: number
    divergent: Array<{ comparison: string; note: string }>
    executionMode: string
  } | null
}) {
  if (!replay) {
    return (
      <EmptyState
        title="No replay comparison"
        description="No replay run has been recorded for this candidate against production."
      />
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-4">
          <dt className={eyebrowClass}>Provenance</dt>
          <dd className="mt-1">
            <ExecutionModeBadge mode={replay.executionMode} />
          </dd>
        </div>
        <div>
          <dt className={eyebrowClass}>Verdict</dt>
          <dd className="mt-1 text-sm text-zinc-200">{replay.verdict ?? '—'}</dd>
        </div>
        <div>
          <dt className={eyebrowClass}>Cases replayed</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-white">{replay.caseCount}</dd>
        </div>
        <div>
          <dt className={eyebrowClass}>Divergent cases</dt>
          <dd className="mt-1 font-mono text-sm tabular-nums text-white">{replay.divergent.length}</dd>
        </div>
      </dl>
      {replay.executionMode !== 'live_langgraph' ? (
        <Text className="!mt-0 !text-xs">
          This is a deterministic $0 simulation proving the replay machinery — it did NOT exercise
          the candidate&apos;s real behavior, and cannot satisfy a required replay-comparison
          promotion check.
        </Text>
      ) : null}
      {replay.divergent.length > 0 ? (
        <ul className="flex max-h-56 flex-col overflow-y-auto">
          {replay.divergent.map((entry, i) => (
            <li
              key={i}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2 last:border-0"
            >
              <span className="text-xs text-zinc-300">{entry.note}</span>
              <span className="text-xs text-zinc-500">{entry.comparison}</span>
            </li>
          ))}
        </ul>
      ) : (
        <Text className="!mt-0 !text-xs">No case compared worse or non-deterministic against production.</Text>
      )}
    </div>
  )
}

/** The overall verdict line, same four-word vocabulary as the check statuses. */
export function PromotionOverall({ overall, promotable }: { overall: PromotionCheckStatus; promotable: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <Text className="!mt-0 !text-xs">
        {promotable
          ? 'Every extended promotion check passes.'
          : 'The extended promotion checks do not currently permit a promotion.'}
      </Text>
      <PromotionStatusText status={overall} />
    </div>
  )
}

/**
 * Trigger a shadow experiment or a replay comparison for the candidate this
 * page is already looking at (AIGENT-FACTORY-SHADOW-REPLAY-001).
 *
 * Same shape as `ReleaseActions` in release-panel.tsx: a button opens a
 * confirmation `Dialog`, submission goes through `pending` / `error` / `done`
 * state, and a success re-reads the server with `router.refresh()` rather than
 * patching a local copy. This lives inside "Promotion evidence" — not a new
 * Section — because it produces exactly the evidence that section already
 * renders (`ShadowEvidence` / `ReplayEvidence` above); a second cockpit would
 * duplicate that read.
 *
 * `runningStatus` comes from the same GET the page already used to build
 * `shadow` / `replay` — the button disables client-side the moment the kind
 * is `queued` or `running`, before a click can ever reach the server. The
 * route's own 409 concurrency guard is the second line of defense, not the
 * only one: relying on it alone would let an operator click a dead button and
 * only learn it was pointless after a round trip.
 */
export function ProofActions({
  copilotId,
  versionId,
  versionLabel,
  kind,
  runningStatus,
}: {
  copilotId: string
  versionId: string
  versionLabel: string | null
  kind: 'shadow' | 'replay'
  /** `experiment.status` / `comparison.status` from the matching GET, when known. */
  runningStatus: string | null
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [insufficientEvidence, setInsufficientEvidence] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const isRunning = runningStatus === 'queued' || runningStatus === 'running'
  // PR #22 rework: both routes are fixture-only today (no live_langgraph path
  // exists yet — see docs/factory-shadow-replay-001.md) — the button says so
  // up front rather than let an operator discover it only after reading the
  // ExecutionModeBadge on the resulting evidence.
  const label = kind === 'shadow' ? 'Run shadow experiment (fixture)' : 'Run replay comparison (fixture)'
  const verb = kind === 'shadow' ? 'shadow experiment' : 'replay comparison'

  async function submit() {
    setPending(true)
    setError(null)
    setInsufficientEvidence(null)
    setDone(null)
    try {
      const response = await fetch(
        `/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/versions/${encodeURIComponent(versionId)}/${kind}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // `useFixture` is intentionally never sent: shadow has no wired
          // real/fixture toggle at all (the route ignores `false` and always
          // runs its deterministic $0 fixture path), and replay's toggle is
          // wired but not exposed here — there is no live/fixture choice in
          // this UI, so the field is omitted rather than forced to a value
          // the operator never chose.
          body: JSON.stringify({}),
        },
      )
      const body = (await response.json().catch(() => null)) as
        | { error?: string; code?: string; verdict?: string; wouldMutateCount?: number }
        | null
      if (!response.ok) {
        if (response.status === 422 && body?.code === 'INSUFFICIENT_EVIDENCE') {
          setInsufficientEvidence(
            body?.error ?? 'No corpus is available yet to run this comparison — not a failing result.',
          )
          return
        }
        setError(body?.error ?? (await messageForResponse(response, `${verb} failed (${response.status}).`)))
        return
      }
      if (body?.verdict === 'INSUFFICIENT_EVIDENCE') {
        setInsufficientEvidence('Recorded, but there was not enough evidence to reach a verdict.')
      } else {
        setDone(
          `${verb} (deterministic fixture, $0) recorded${versionLabel ? ` for ${versionLabel}` : ''} — this proves the machinery, not the candidate's real behavior; see the Provenance badge below.`,
        )
      }
      setConfirming(false)
      router.refresh()
    } catch {
      setError(`${verb} failed — the backend is unreachable.`)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button outline disabled={pending || isRunning} onClick={() => setConfirming(true)}>
          {isRunning ? (
            <>
              <Spinner />
              {kind === 'shadow' ? 'Shadow experiment running…' : 'Replay comparison running…'}
            </>
          ) : (
            label
          )}
        </Button>
      </div>

      <div aria-live="polite">
        {done ? <Text className="!mt-0 !text-xs">{done}</Text> : null}
        {insufficientEvidence ? (
          <Text className="!mt-0 !text-xs">{insufficientEvidence}</Text>
        ) : null}
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <Dialog open={confirming} onClose={() => setConfirming(false)} size="lg">
        <DialogTitle>
          {kind === 'shadow' ? 'Run a shadow experiment (fixture)' : 'Run a replay comparison (fixture)'}
          {versionLabel ? ` for ${versionLabel}` : ''}?
        </DialogTitle>
        <DialogDescription>
          {kind === 'shadow'
            ? 'Runs a deterministic, $0 SIMULATION — not a real run of the candidate — against the certified count_words tool, proving the mutating-tool block and the evidence path without serving anything to a real consumer.'
            : 'Runs a deterministic, $0 SIMULATION comparing scripted outcomes — not a real run of the candidate or production — and records where they diverge.'}
        </DialogDescription>
        <DialogBody>
          <Text className="!mt-0">
            This evidence is recorded with provenance <code className="rounded bg-white/5 px-1 py-0.5 font-mono text-xs">deterministic_fixture</code>{' '}
            and CANNOT satisfy a promotion check that requires shadow/replay proof — only a live LangGraph run can (see the Provenance badge on the resulting evidence).{' '}
            {kind === 'shadow'
              ? 'Nothing here changes what consumers are served. It does not promote anything by itself.'
              : 'This does not re-run the release gate or write anything to production.'}
          </Text>
        </DialogBody>
        <DialogActions>
          <Button plain disabled={pending} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button color="accent" disabled={pending} onClick={() => void submit()}>
            {pending ? (
              <>
                <Spinner />
                Starting…
              </>
            ) : (
              'Confirm'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
