'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/surface-card'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { GateStatus, ReleaseCheck, ReleaseEvidence } from '@/lib/agent-mission-control/release-gate'

// Status → LABEL + solid accent dot (doctrine: meaning is never colour alone).
function CheckStatus({ status }: { status: GateStatus }) {
  const label = status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Missing'
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        aria-hidden="true"
        className={'size-1.5 rounded-full ' + (status === 'pass' ? 'bg-accent-500' : 'bg-zinc-400 dark:bg-zinc-500')}
      />
      <span className={status === 'pass' ? 'text-accent-700 dark:text-accent-300' : 'text-zinc-600 dark:text-zinc-400'}>
        {label}
      </span>
    </span>
  )
}

/**
 * The controlled release gate for a candidate version. Renders the REAL
 * evidence (latest test run, benchmark, guardrail counts, tool policy) and the
 * per-check verdicts computed server-side by evaluateReleaseGate. The Promote
 * button is enabled only when every check passes — and even then the promotion
 * route re-checks the gate before writing, so a stale-enabled button can't
 * force a promotion. Promotion is confirmed in a dialog; it never touches
 * GitHub or any external system.
 */
export function ReleaseCandidateCard({
  copilotId,
  checks,
  promotable,
  evidence,
  currentProductionLabel,
  rollbackVersionId,
  rollbackVersionLabel,
}: {
  copilotId: string
  checks: ReleaseCheck[]
  promotable: boolean
  evidence: ReleaseEvidence
  currentProductionLabel: string | null
  /** Previous production version to roll back to — null when there's none. */
  rollbackVersionId?: string | null
  rollbackVersionLabel?: string | null
}) {
  const router = useRouter()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [pending, setPending] = useState<'promote' | 'rollback' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  async function promote() {
    setPending('promote')
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote',
          versionId: evidence.candidateVersionId,
          previousProductionVersionId: evidence.currentProductionVersionId,
        }),
      })
      if (!res.ok) {
        throw new Error(await messageForResponse(res, `Promotion failed (${res.status})`))
      }
      setConfirmOpen(false)
      setSuccess(`${evidence.candidateLabel} is now the production version ✓`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Promotion failed')
    } finally {
      setPending(null)
    }
  }

  async function rollback() {
    if (!rollbackVersionId) return
    setPending('rollback')
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback',
          versionId: rollbackVersionId,
          previousProductionVersionId: evidence.currentProductionVersionId,
        }),
      })
      if (!res.ok) {
        throw new Error(await messageForResponse(res, `Rollback failed (${res.status})`))
      }
      setRollbackOpen(false)
      setSuccess(`Rolled back to ${rollbackVersionLabel ?? rollbackVersionId} ✓`)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollback failed')
    } finally {
      setPending(null)
    }
  }

  const blocking = checks.filter((c) => c.status !== 'pass').map((c) => c.label)

  return (
    <AgentSectionCard
      title={`Release candidate — ${evidence.candidateLabel}`}
      description="Every check is evaluated live from the candidate's real test run, benchmark and tool policy. Promotion to production is manual and only unlocks when all checks pass."
      actions={
        <Badge color={promotable ? 'accent' : 'zinc'}>{promotable ? 'Ready to promote' : 'Blocked'}</Badge>
      }
    >
      <div className="space-y-6">
        {/* Evidence summary — the numbers the gate is built on. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tests</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.testRun ? `${evidence.testRun.passed}/${evidence.testRun.total} pass` : 'missing'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Benchmark</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.benchmark ? `${Math.round(evidence.benchmark.score * 10) / 10} / 100` : 'missing'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Accuracy</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.benchmark ? `${Math.round(evidence.benchmark.accuracy * 100)}%` : 'missing'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Unsafe actions</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.benchmark ? String(evidence.benchmark.unsafeActionCount) : 'missing'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Confirmation mistakes</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.benchmark ? String(evidence.benchmark.confirmationMistakeCount) : 'missing'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Tool policy</dt>
            <dd className="mt-1 text-sm text-zinc-950 dark:text-white">
              {evidence.toolRiskWrites.length === 0 ? 'read-only' : `writes: ${evidence.toolRiskWrites.join(', ')}`}
            </dd>
          </div>
        </dl>

        {/* Per-check verdicts. */}
        <ul className="divide-y divide-zinc-950/5 rounded-lg ring-1 ring-zinc-950/5 dark:divide-white/10 dark:ring-white/10">
          {checks.map((check) => (
            <li key={check.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <span className="text-sm text-zinc-800 dark:text-zinc-200">{check.label}</span>
              <span className="flex items-center gap-3 text-xs">
                <span className="text-zinc-500">
                  {check.observed} <span className="text-zinc-400">/ req {check.required}</span>
                </span>
                <CheckStatus status={check.status} />
              </span>
            </li>
          ))}
        </ul>

        {/* Current production + rollback context. */}
        <p className="text-xs text-zinc-500">
          {evidence.currentProductionVersionId
            ? `Current production: ${currentProductionLabel ?? evidence.currentProductionVersionId} — promotion keeps it as the rollback target.`
            : 'No version is in production yet — this would be the first production version.'}
        </p>

        {/* Action — the single Promote button for this copilot, plus rollback
            when a previous production version exists. */}
        <div className="flex flex-wrap items-center gap-3">
          {promotable ? (
            <Button color="accent" disabled={pending !== null} onClick={() => setConfirmOpen(true)}>
              Promote {evidence.candidateLabel} to production
            </Button>
          ) : (
            <Button outline disabled>
              Promote to production
            </Button>
          )}
          {rollbackVersionId && rollbackVersionLabel ? (
            <Button plain disabled={pending !== null} onClick={() => setRollbackOpen(true)}>
              <span className="text-accent-600 dark:text-accent-400">
                Rollback to <span className="font-mono tabular-nums">{rollbackVersionLabel}</span>
              </span>
            </Button>
          ) : null}
          {!promotable ? (
            <span className="text-xs text-zinc-500">Blocked by: {blocking.join(', ')}.</span>
          ) : null}
        </div>

        <div aria-live="polite">
          {success ? <p className="text-xs font-medium text-zinc-950 dark:text-white">{success}</p> : null}
          {error ? <p className="text-xs font-medium text-accent-600 dark:text-accent-400">{error}</p> : null}
        </div>
      </div>

      <Dialog open={confirmOpen} onClose={setConfirmOpen} size="lg">
        <DialogTitle>Promote {evidence.candidateLabel} to production?</DialogTitle>
        <DialogDescription>
          This sets <span className="font-mono tabular-nums">production_version_id</span> to{' '}
          <span className="font-mono tabular-nums">{evidence.candidateVersionId}</span>.
        </DialogDescription>
        <DialogBody>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This does not push GitHub or change any external system. The gate is re-checked on the server before the
            write; if a check has regressed since this page loaded, the promotion is refused.
            {evidence.currentProductionVersionId
              ? ' The version currently in production becomes the rollback target.'
              : ' This is the first production version for this copilot.'}
          </p>
        </DialogBody>
        <DialogActions>
          <Button plain disabled={pending !== null} onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button color="accent" disabled={pending !== null} onClick={promote}>
            {pending === 'promote' ? 'Promoting…' : 'Confirm promotion'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={rollbackOpen} onClose={setRollbackOpen} size="lg">
        <DialogTitle>Rollback production?</DialogTitle>
        <DialogDescription>
          All production traffic would be routed back to{' '}
          <span className="font-mono tabular-nums">{rollbackVersionLabel ?? rollbackVersionId}</span>.
        </DialogDescription>
        <DialogBody>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This restores a previously-shipped version (which already passed the gate) and does not push GitHub or
            change any external system. The current candidate stays here and can be promoted again later.
          </p>
        </DialogBody>
        <DialogActions>
          <Button plain disabled={pending !== null} onClick={() => setRollbackOpen(false)}>
            Cancel
          </Button>
          <Button color="accent" disabled={pending !== null || !rollbackVersionId} onClick={rollback}>
            {pending === 'rollback' ? 'Rolling back…' : 'Confirm rollback'}
          </Button>
        </DialogActions>
      </Dialog>
    </AgentSectionCard>
  )
}
