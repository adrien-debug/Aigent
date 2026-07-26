'use client'

import { useRouter } from 'next/navigation'
import { useState, type CSSProperties } from 'react'

import { ErrorBanner, Spinner } from '@/components/agent-ops/authoring-primitives'
import { eyebrowClass } from '@/components/agent-ops/surface-card'
import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Text } from '@/components/ui/text'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Capability } from '@/lib/agent-mission-control/agent-lifecycle'
import type { GateStatus, ReleaseCheck } from '@/lib/agent-mission-control/release-gate'

/**
 * Release actions — the two writes that change what consumers are served
 * (AIGENT-OPERATOR-RESTORE-028).
 *
 * Everything this component renders is decided elsewhere: `evaluateReleaseGate`
 * owns promotability, `getAgentLifecycle` owns whether an action may be
 * offered. Nothing is recomputed here — a UI that disagreed with the gate would
 * only be promising a 422, because `promotion/route.ts` re-evaluates the same
 * gate server-side before any write.
 *
 * Three things this surface must not do:
 *
 * 1. **Promote by itself.** There is no automatic promotion anywhere in this
 *    codebase and this component adds none: both writes are behind a click and
 *    a confirmation dialog. The page states which steps are human.
 * 2. **Show a dead button.** A disabled control always renders the capability's
 *    `reason` next to it, not behind a hover — a tooltip is invisible on touch.
 * 3. **Paint a destructive act like the happy path.** Promote is the gate's
 *    green outcome and wears the accent. Rollback moves production BACKWARD off
 *    the version currently serving; it carries the `--state-danger-*` role, as
 *    `delete-project-dialog.tsx` established, so the two affordances are not
 *    pixel-identical.
 */

/**
 * Catalyst exposes no `danger` colour key and `components/ui/` is out of
 * scope here, so the destructive fill rides the button's own `--btn-*` custom
 * properties. Inline style, not a className: the `zinc` colour array ALSO
 * declares `--btn-bg`, and which declaration wins depends on the order Tailwind
 * emits the utilities, not on clsx concatenation order. Verbatim from
 * `delete-project-dialog.tsx` — same role, same values, on purpose.
 */
type ButtonVars = CSSProperties & Record<'--btn-bg' | '--btn-border' | '--btn-hover-overlay', string>

const dangerSolidStyle: ButtonVars = {
  '--btn-bg': 'var(--state-danger-solid)',
  '--btn-border': 'var(--state-danger-solid-line)',
  '--btn-hover-overlay': 'rgb(255 255 255 / 12%)',
}

/**
 * `missing` is NOT `fail`, and the two must not read alike.
 *
 * A failed check saw the evidence and rejected it. A missing check never got
 * any evidence — nothing was measured. Collapsing them into one red word tells
 * an operator the agent misbehaved when in truth nobody has looked yet, and the
 * remedies are opposite: fix the agent vs. run the measurement. Both block
 * promotion (`promotable` requires every check to `pass`), which is why the
 * dot is filled for `pass` only; the WORD carries the distinction, never the
 * colour alone.
 */
function CheckStatusText({ status }: { status: GateStatus }) {
  const label = status === 'pass' ? 'Pass' : status === 'fail' ? 'Fail' : 'Not measured'
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-xs">
      <span
        aria-hidden="true"
        className={
          status === 'pass'
            ? 'size-1.5 rounded-full bg-accent-500'
            : status === 'fail'
              ? 'size-1.5 rounded-full bg-[var(--state-danger-solid)]'
              : 'size-1.5 rounded-full ring-1 ring-zinc-400 dark:ring-zinc-500'
        }
      />
      <span
        className={
          status === 'pass'
            ? 'text-accent-700 dark:text-accent-300'
            : status === 'fail'
              ? 'text-[var(--state-danger-text)]'
              : 'text-zinc-500 dark:text-zinc-400'
        }
      >
        {label}
      </span>
    </span>
  )
}

/** The nine gate checks with their real observed value and requirement. */
export function ReleaseGateChecks({ checks }: { checks: ReleaseCheck[] }) {
  return (
    <ul className="flex flex-col">
      {checks.map((check) => (
        <li
          key={check.id}
          className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-white/5 py-2.5 last:border-0"
        >
          <span className="text-sm text-zinc-200">{check.label}</span>
          <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-mono text-xs tabular-nums text-zinc-400">
              {/* `zinc-400`: the threshold is what makes the observed value
                  readable as pass or fail, so it is not decoration. `zinc-500`
                  measures 3.59 against this plane. */}
              {check.observed} <span className="text-zinc-400">· requires {check.required}</span>
            </span>
            <CheckStatusText status={check.status} />
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The reason a control is off, rendered AS TEXT next to it.
 *
 * `reason` is the operator sentence; `detail` is the verifiable technical
 * cause. Both are shown: the second is what lets someone check the claim
 * against the code instead of trusting the UI.
 */
export function CapabilityNote({ capability }: { capability: Capability }) {
  if (capability.state === 'available') return null
  return (
    <div className="max-w-prose">
      {/* Not the agent-status vocabulary: this labels a CAPABILITY (may this
          control be offered), which is a different claim from the agent's
          runtime status shown in the header. Borrowing the status words here
          would put two meanings on one screen under one label. */}
      <p className={eyebrowClass}>
        {capability.state === 'degraded' ? 'Runs, but proves less' : 'Not offered'}
      </p>
      <p className="mt-1 text-sm text-zinc-300">{capability.reason}</p>
      <p className="mt-1 text-xs leading-5 text-zinc-400">{capability.detail}</p>
    </div>
  )
}

export function ReleaseActions({
  copilotId,
  candidateVersionId,
  candidateLabel,
  currentProductionVersionId,
  productionLabel,
  rollbackVersionId,
  rollbackVersionLabel,
  promote,
  rollback,
}: {
  copilotId: string
  /** Null when the gate found no candidate — then Promote is not rendered at all. */
  candidateVersionId: string | null
  candidateLabel: string | null
  currentProductionVersionId: string | null
  productionLabel: string | null
  /** The archived version production would return to; null when there is none. */
  rollbackVersionId: string | null
  rollbackVersionLabel: string | null
  promote: Capability
  rollback: Capability
}) {
  const router = useRouter()
  const [confirming, setConfirming] = useState<'promote' | 'rollback' | null>(null)
  const [pending, setPending] = useState<'promote' | 'rollback' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  const canPromote = promote.state === 'available' && candidateVersionId !== null
  const canRollback = rollback.state === 'available' && rollbackVersionId !== null

  async function submit(action: 'promote' | 'rollback', versionId: string, successMessage: string) {
    setPending(action)
    setError(null)
    setDone(null)
    try {
      const response = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          versionId,
          previousProductionVersionId: currentProductionVersionId,
        }),
      })
      if (!response.ok) {
        // 422 carries the server's own blocking list — surfacing the generic
        // message would hide exactly the information the operator needs.
        const body = (await response.json().catch(() => null)) as { error?: string; blocking?: string[] } | null
        if (response.status === 422 && Array.isArray(body?.blocking) && body.blocking.length > 0) {
          setError(`${body.error ?? 'Refused by the release gate'} — ${body.blocking.join(' · ')}`)
          return
        }
        setError(body?.error ?? (await messageForResponse(response, `${action} failed (${response.status}).`)))
        return
      }
      setConfirming(null)
      setDone(successMessage)
      // The gate, the stages and the production pointer all moved server-side;
      // re-read rather than patch a local copy that would drift.
      router.refresh()
    } catch {
      setError(`${action === 'promote' ? 'Promotion' : 'Rollback'} failed — the backend is unreachable.`)
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          color="accent"
          disabled={!canPromote || pending !== null}
          onClick={() => setConfirming('promote')}
        >
          {candidateLabel ? `Promote ${candidateLabel} to production` : 'Promote to production'}
        </Button>
        <Button
          color="zinc"
          style={dangerSolidStyle}
          disabled={!canRollback || pending !== null}
          onClick={() => setConfirming('rollback')}
        >
          {rollbackVersionLabel ? `Roll back to ${rollbackVersionLabel}` : 'Roll back production'}
        </Button>
      </div>

      {promote.state !== 'available' ? <CapabilityNote capability={promote} /> : null}
      {rollback.state !== 'available' ? <CapabilityNote capability={rollback} /> : null}

      <div aria-live="polite">
        {done ? <Text className="text-xs">{done}</Text> : null}
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      <Dialog open={confirming === 'promote'} onClose={() => setConfirming(null)} size="lg">
        <DialogTitle>Promote {candidateLabel ?? 'this candidate'} to production?</DialogTitle>
        <DialogDescription>
          Consumers resolving this agent would start being served{' '}
          <span className="font-mono tabular-nums break-all">{candidateVersionId}</span>.
        </DialogDescription>
        <DialogBody>
          <Text>
            The release gate is re-evaluated on the server before anything is written: if a check has
            regressed since this page loaded, the promotion is refused and nothing changes.
            {currentProductionVersionId
              ? ' The version serving production today is archived and becomes the rollback target.'
              : ' This is the first production version for this agent.'}{' '}
            No GitHub push and no external system is touched.
          </Text>
        </DialogBody>
        <DialogActions>
          <Button plain disabled={pending !== null} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            color="accent"
            disabled={pending !== null || candidateVersionId === null}
            onClick={() => {
              if (candidateVersionId === null) return
              void submit('promote', candidateVersionId, `${candidateLabel ?? candidateVersionId} is now the production version.`)
            }}
          >
            {pending === 'promote' ? (
              <>
                <Spinner />
                Promoting…
              </>
            ) : (
              'Confirm promotion'
            )}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirming === 'rollback'} onClose={() => setConfirming(null)} size="lg">
        <DialogTitle>Roll production back to {rollbackVersionLabel ?? 'the previous version'}?</DialogTitle>
        <DialogDescription>
          Every consumer served by{' '}
          <span className="font-mono tabular-nums break-all">{productionLabel ?? currentProductionVersionId ?? 'the current version'}</span>{' '}
          would immediately be served{' '}
          <span className="font-mono tabular-nums break-all">{rollbackVersionId}</span> instead.
        </DialogDescription>
        <DialogBody>
          <Text>
            A rollback restores a version that already shipped, so the promotion route exempts it from
            the release gate — nothing re-checks it. The version serving production today is archived by
            the same transition; promoting it again later is a fresh gate evaluation, not an undo.
          </Text>
        </DialogBody>
        <DialogActions>
          <Button plain disabled={pending !== null} onClick={() => setConfirming(null)}>
            Cancel
          </Button>
          <Button
            color="zinc"
            style={dangerSolidStyle}
            disabled={pending !== null || rollbackVersionId === null}
            onClick={() => {
              if (rollbackVersionId === null) return
              void submit('rollback', rollbackVersionId, `Production rolled back to ${rollbackVersionLabel ?? rollbackVersionId}.`)
            }}
          >
            {pending === 'rollback' ? (
              <>
                <Spinner />
                Rolling back…
              </>
            ) : (
              'Confirm rollback'
            )}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}

/** Small legend: which steps a human performs, and which the platform does. */
export function ReleaseOwnership({ gateEvaluated }: { gateEvaluated: boolean }) {
  return (
    <ul className="flex flex-col">
      {[
        {
          who: 'Automatic',
          what: gateEvaluated
            ? 'The nine gate checks above are recomputed from live test runs, benchmarks and tool policy on every page load, and again on the server before any promotion write.'
            : 'The gate checks would be recomputed from live data — there is no candidate to evaluate right now.',
        },
        {
          who: 'Automatic',
          what: 'Stage transitions: the promoted version becomes production and the outgoing one is archived, in one write with the copilot’s production pointer.',
        },
        {
          who: 'Human',
          what: 'The decision to promote. Nothing in this platform promotes on its own — a green gate is a permission, never a trigger.',
        },
        {
          who: 'Human',
          what: 'The decision to roll back, which the gate does not guard: it restores a version that already shipped.',
        },
      ].map((row) => (
        <li key={row.what} className="flex gap-3 border-b border-white/5 py-2.5 last:border-0">
          <span className="w-20 shrink-0 text-xs font-medium text-zinc-300">{row.who}</span>
          <span className="min-w-0 text-xs leading-5 text-zinc-400">{row.what}</span>
        </li>
      ))}
    </ul>
  )
}
