'use client'

import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import type { Blocker } from '@/lib/agent-mission-control/agent-detail'
import type { Copilot, CopilotVersion } from '@/lib/agent-mission-control/types'

/**
 * Governed promotion + delivery controls for one copilot, mounted client-side
 * under the READ-ONLY server-rendered `Delivery` panel in `agent-detail-screen.tsx`.
 *
 * REUSES EXACTLY THREE EXISTING ROUTES — none created for this component:
 *   - POST /api/agent-ops/copilots/:copilotId/promotion   (action: 'promote')
 *   - POST /api/agent-ops/projects/:id/push-agent          (dry-run only here)
 *   - POST /api/agent-ops/copilots/:copilotId/delivery-loop
 *
 * WHY THE "EVALUATE" STEP IS THE SAME CALL AS THE "PROMOTE" STEP.
 * The 9-check release gate (`release-gate.ts`) plus the 5-check promotion gate
 * (`promotion-gate.ts`) are evaluated LIVE, server-side, only inside the
 * promotion route — there is no read-only preview route, and this mission is
 * explicit: invent none. The route itself is fail-closed by construction: a
 * blocked gate returns 422 and performs ZERO writes (the DB transition only
 * runs after `result.promotable` is confirmed true, inside the same request).
 * So calling the route IS the honest way to "check" — a failing check never
 * mutates anything. The strong confirmation dialog exists precisely because a
 * PASSING gate on this same click really does promote; the dialog is the
 * user's last chance to back out before that happens.
 *
 * TRUTH VOCABULARY (never invented): this component only ever shows a status
 * word that came out of a live response body — 'dry-run', the route's own
 * `pushed`/`dryRun` booleans, or the free-text `state`/`status` a route
 * returned. It never writes the word "deployed": no route response in this
 * product carries proof of a downstream consumer having deployed the code —
 * the furthest verified fact is "pushed to the repo" (commit or PR opened).
 */

type PromotionOutcome =
  | { kind: 'idle' }
  | { kind: 'blocked'; overall: string; blocking: string[] }
  | { kind: 'promoted'; productionVersionId: string }
  | { kind: 'error'; message: string }

type PushOutcome =
  | { kind: 'idle' }
  | {
      kind: 'result'
      pushed: boolean
      dryRun: boolean
      mode: 'direct_commit' | 'pull_request'
      prUrl?: string
      prNumber?: number
      commitUrl?: string
      commitSha?: string
      branch: string
    }
  | { kind: 'error'; message: string }

type LoopOutcome =
  | { kind: 'idle' }
  | { kind: 'result'; state: unknown }
  | { kind: 'error'; message: string }

function outcomeTone(kind: string): StatusDotTone {
  if (kind === 'promoted' || kind === 'result') return 'positive'
  if (kind === 'blocked' || kind === 'error') return 'negative'
  return 'neutral'
}

/**
 * Minimal accessible confirmation dialog. No `Dialog`/modal primitive exists
 * yet in `src/components/ui/` (checked: only button/table/status-dot/etc.), so
 * this composes Headless UI's `Dialog` directly — the same dependency already
 * powering `src/components/ui/button.tsx` (`@headlessui/react`), not a new
 * design system.
 */
function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  description: React.ReactNode
  confirmLabel: string
  danger?: boolean
  busy: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onClose={busy ? () => {} : onClose} className="relative z-50">
      <div className="fixed inset-0 bg-black/60" aria-hidden="true" />
      <div className="fixed inset-0 flex w-screen items-center justify-center p-4">
        <DialogPanel className="w-full max-w-md rounded-xl border border-line bg-surface-raised p-5">
          <DialogTitle className="text-sm font-semibold text-white">{title}</DialogTitle>
          <div className="mt-2 text-[12px]/5 text-zinc-400">{description}</div>
          <div className="mt-5 flex justify-end gap-2">
            <Button outline onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button color={danger ? 'danger' : 'accent'} onClick={onConfirm} disabled={busy}>
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  )
}

export function DeliveryControls({
  copilot,
  projectId,
  repoFullName,
  blockers,
  candidateVersion,
}: {
  copilot: Copilot
  /** Canonical `AvailableAgent.projectId` — see the same guard already applied
   *  in `agent-detail-screen.tsx` for why this and not the raw `copilot.projectId`. */
  projectId: string | null
  repoFullName: string | undefined
  /** The run gate's own blockers (`getAgentDetail`), reused here as a CHEAP,
   *  already-computed pre-check — distinct from, and narrower than, the
   *  9-check release gate / 5-check promotion gate the promotion route itself
   *  evaluates live. Shown so a doomed promotion attempt is visibly
   *  discouraged before the user ever opens the confirm dialog. */
  blockers: Blocker[]
  /** The version this panel offers to promote — the latest, when it is not
   *  already the one serving production. `undefined` when there is nothing to
   *  promote (no candidate distinct from production). */
  candidateVersion: CopilotVersion | undefined
}) {
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const [promoteOpen, setPromoteOpen] = useState(false)
  const [promoting, setPromoting] = useState(false)
  const [promotion, setPromotion] = useState<PromotionOutcome>({ kind: 'idle' })

  const [pushing, setPushing] = useState(false)
  const [push, setPush] = useState<PushOutcome>({ kind: 'idle' })

  const [realPushOpen, setRealPushOpen] = useState(false)
  const [realPushing, setRealPushing] = useState(false)

  const [loopRunning, setLoopRunning] = useState(false)
  const [loop, setLoop] = useState<LoopOutcome>({ kind: 'idle' })

  const hasRepo = typeof repoFullName === 'string' && repoFullName.length > 0
  const hasProject = projectId !== null

  // AIGENT: real GitHub writes require BOTH `confirm:true` in the body AND
  // `GITHUB_PUSH_ENABLED=1` server-side (push-agent/route.ts:163). The client
  // has no legitimate way to read that env var — no route exposes it, and
  // inventing one is out of scope for this mission. So the real-delivery path
  // stays visible but NEVER auto-enables: it is offered, the confirm dialog is
  // wired, but the button is disabled with an explicit "not available in this
  // environment" reason UNLESS a push attempt already proved it live (a prior
  // 200 with `dryRun:false` in this same session). That is the only honest
  // client-side signal available.
  const [realPushProvenAvailable, setRealPushProvenAvailable] = useState(false)

  async function runPromotion() {
    if (promoting || candidateVersion === undefined) return
    setPromoting(true)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilot.id}/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'promote',
          versionId: candidateVersion.id,
          previousProductionVersionId: copilot.productionVersionId ?? null,
        }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        overall?: string
        blocking?: string[]
        productionVersionId?: string
      }
      if (!mountedRef.current) return
      if (res.status === 422) {
        setPromotion({ kind: 'blocked', overall: body.overall ?? 'FAIL', blocking: body.blocking ?? [] })
      } else if (res.ok) {
        setPromotion({ kind: 'promoted', productionVersionId: body.productionVersionId ?? candidateVersion.id })
        setPromoteOpen(false)
      } else {
        setPromotion({ kind: 'error', message: body.error ?? `promotion failed (${res.status})` })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setPromotion({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
    } finally {
      if (mountedRef.current) setPromoting(false)
    }
  }

  async function runPush(confirmReal: boolean) {
    if (!hasProject || pushing || realPushing) return
    const setBusy = confirmReal ? setRealPushing : setPushing
    setBusy(true)
    try {
      const res = await fetch(`/api/agent-ops/projects/${projectId}/push-agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // `confirm:true` is only ever sent from the explicit "real delivery"
        // confirm dialog, gated further below by `realPushProvenAvailable` —
        // this mission's default flow (the plain "Dry-run delivery" button)
        // never sends it, so it is always a dry-run by construction.
        body: JSON.stringify(confirmReal ? { copilotId: copilot.id, confirm: true } : { copilotId: copilot.id }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        pushed?: boolean
        dryRun?: boolean
        mode?: 'direct_commit' | 'pull_request'
        prUrl?: string
        prNumber?: number
        commitUrl?: string
        commitSha?: string
        branch?: string
      }
      if (!mountedRef.current) return
      if (res.ok && typeof body.pushed === 'boolean' && typeof body.dryRun === 'boolean') {
        setPush({
          kind: 'result',
          pushed: body.pushed,
          dryRun: body.dryRun,
          mode: body.mode ?? 'pull_request',
          prUrl: body.prUrl,
          prNumber: body.prNumber,
          commitUrl: body.commitUrl,
          commitSha: body.commitSha,
          branch: body.branch ?? '',
        })
        // The only honest client-side proof that the real-delivery path is
        // actually wired in this environment: a response that came back with
        // `dryRun:false`. Until that happens, the button stays disabled.
        if (body.dryRun === false) setRealPushProvenAvailable(true)
        if (confirmReal) setRealPushOpen(false)
      } else {
        setPush({ kind: 'error', message: body.error ?? `push failed (${res.status})` })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setPush({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }

  async function runDeliveryLoop() {
    if (loopRunning) return
    setLoopRunning(true)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${copilot.id}/delivery-loop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const body = (await res.json().catch(() => ({}))) as { error?: string; state?: unknown }
      if (!mountedRef.current) return
      if (res.ok) {
        setLoop({ kind: 'result', state: body.state })
      } else {
        setLoop({ kind: 'error', message: body.error ?? `delivery loop failed (${res.status})` })
      }
    } catch (err) {
      if (!mountedRef.current) return
      setLoop({ kind: 'error', message: err instanceof Error ? err.message : 'network error' })
    } finally {
      if (mountedRef.current) setLoopRunning(false)
    }
  }

  const promotionDisabledReason =
    candidateVersion === undefined
      ? 'No candidate version to promote (nothing beyond current production).'
      : blockers.length > 0
        ? `Execution gate reports ${blockers.length} blocker${blockers.length > 1 ? 's' : ''} — see "Execution gate" above.`
        : null

  return (
    <div className="space-y-3 border-t border-line px-4 py-3.5">
      {/* ── Promotion ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-zinc-500">
              Promotion
            </p>
            <p className="mt-0.5 text-[11px]/4 text-zinc-500">
              Re-evaluates the full release gate live before writing anything. A failing gate never mutates.
            </p>
          </div>
          <Button
            color="accent"
            disabled={promotionDisabledReason !== null || promoting}
            onClick={() => setPromoteOpen(true)}
          >
            Promote {candidateVersion ? candidateVersion.label : 'version'}
          </Button>
        </div>
        {promotionDisabledReason ? (
          <p className="mt-1.5 text-[11px]/4 text-[var(--state-danger-text)]">{promotionDisabledReason}</p>
        ) : null}
        {promotion.kind !== 'idle' ? (
          <div className="mt-2 rounded-lg border border-line px-3 py-2">
            <StatusDot tone={outcomeTone(promotion.kind)}>
              {promotion.kind === 'promoted'
                ? `Promoted — production_version_id = ${promotion.productionVersionId}`
                : promotion.kind === 'blocked'
                  ? `Gate ${promotion.overall} — promotion blocked`
                  : promotion.kind === 'error'
                    ? promotion.message
                    : ''}
            </StatusDot>
            {promotion.kind === 'blocked' && promotion.blocking.length > 0 ? (
              <ul className="mt-1.5 space-y-0.5">
                {promotion.blocking.map((line) => (
                  <li key={line} className="text-[11px]/4 text-zinc-400">
                    {line}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ── Delivery ──────────────────────────────────────────────────── */}
      <div className="border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-zinc-500">Delivery</p>
            <p className="mt-0.5 text-[11px]/4 text-zinc-500">
              {hasRepo ? `Target: ${repoFullName}` : 'No repository is linked to this project.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button outline disabled={!hasProject || !hasRepo || pushing} onClick={() => void runPush(false)}>
              {pushing ? 'Running…' : 'Dry-run delivery'}
            </Button>
            <Button
              plain
              dangerIcon
              disabled={!hasProject || !hasRepo || !realPushProvenAvailable || realPushing}
              onClick={() => setRealPushOpen(true)}
            >
              Prepare real delivery
            </Button>
          </div>
        </div>
        {!hasProject ? (
          <p className="mt-1.5 text-[11px]/4 text-zinc-500">
            This copilot is not linked to a project — delivery is unavailable.
          </p>
        ) : !hasRepo ? (
          <p className="mt-1.5 text-[11px]/4 text-zinc-500">
            The linked project has no `repoFullName` — link a GitHub repository before delivery.
          </p>
        ) : !realPushProvenAvailable ? (
          <p className="mt-1.5 text-[11px]/4 text-zinc-500">
            Real delivery is not available in this environment (the server did not report `GITHUB_PUSH_ENABLED=1`
            active — a dry-run response is the only signal this UI can read).
          </p>
        ) : null}
        {push.kind === 'result' ? (
          <div className="mt-2 rounded-lg border border-line px-3 py-2">
            <StatusDot tone={outcomeTone(push.kind)}>
              {push.dryRun
                ? 'Dry-run — nothing written to the repository'
                : push.mode === 'pull_request'
                  ? push.prUrl
                    ? `Pull request opened — #${push.prNumber ?? '?'}`
                    : 'Pull request opened'
                  : push.commitSha
                    ? `Committed ${push.commitSha.slice(0, 12)}`
                    : 'Pushed'}
            </StatusDot>
            {push.prUrl ? (
              <p className="mt-1 text-[11px]/4">
                <a href={push.prUrl} className="text-accent-400 hover:underline">
                  {push.prUrl}
                </a>
              </p>
            ) : push.commitUrl ? (
              <p className="mt-1 text-[11px]/4">
                <a href={push.commitUrl} className="text-accent-400 hover:underline">
                  {push.commitUrl}
                </a>
              </p>
            ) : null}
          </div>
        ) : push.kind === 'error' ? (
          <p className="mt-2 text-[11px]/4 text-[var(--state-danger-text)]">{push.message}</p>
        ) : null}
      </div>

      {/* ── Delivery loop (read-only assessment, no confirmation needed —
          the route itself never merges/commits without `runSandbox`, which
          this control never sets) ───────────────────────────────────────── */}
      <div className="border-t border-line pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-[11px]/4 font-semibold uppercase tracking-widest text-zinc-500">
              Delivery loop
            </p>
            <p className="mt-0.5 text-[11px]/4 text-zinc-500">
              Assesses the latest delivery + sandbox and computes readiness. Read-only.
            </p>
          </div>
          <Button outline disabled={loopRunning} onClick={() => void runDeliveryLoop()}>
            {loopRunning ? 'Assessing…' : 'Assess readiness'}
          </Button>
        </div>
        {loop.kind === 'error' ? (
          <p className="mt-2 text-[11px]/4 text-[var(--state-danger-text)]">{loop.message}</p>
        ) : loop.kind === 'result' ? (
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-surface-sunken px-3 py-2 text-[10px]/4 text-zinc-400">
            {JSON.stringify(loop.state, null, 2)}
          </pre>
        ) : null}
      </div>

      <ConfirmDialog
        open={promoteOpen}
        title="Promote to production?"
        description={
          <>
            This re-evaluates the release gate live. If it passes, <strong>{candidateVersion?.label}</strong> becomes
            the production version for <strong>{copilot.name}</strong> immediately — the current production version
            is archived in the same transaction. If the gate fails, nothing is written.
          </>
        }
        confirmLabel="Evaluate and promote"
        busy={promoting}
        onConfirm={() => void runPromotion()}
        onClose={() => setPromoteOpen(false)}
      />

      <ConfirmDialog
        open={realPushOpen}
        title="Deliver for real?"
        description={
          <>
            This sends <code>confirm:true</code> to the push route. It only becomes an actual GitHub write if the
            server also has <code>GITHUB_PUSH_ENABLED=1</code> set — otherwise it still returns a dry-run. A real
            write opens a pull request (or commits directly) against <strong>{repoFullName}</strong>.
          </>
        }
        confirmLabel="Send confirm:true"
        danger
        busy={realPushing}
        onConfirm={() => void runPush(true)}
        onClose={() => setRealPushOpen(false)}
      />
    </div>
  )
}
