'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import type { PromotionGate } from '@/lib/agent-mission-control/types'

type PromotionAction = 'promote' | 'rollback'

/**
 * Decision buttons for the promotion gate. Promote (enabled only when the gate
 * is ready) and rollback write to gpu1 via /api/agent-ops/copilots/:id/promotion
 * and refresh the page from the live source. Human approval is a V2 workflow
 * (kept honestly disabled — no fake success).
 */
export function PublishActions({
  copilotId,
  candidateVersionId,
  productionVersionId,
  rollbackVersionId,
  overallStatus,
  targetStage,
  blockingCheckLabels,
  rollbackVersionLabel,
}: {
  copilotId: string
  candidateVersionId: string
  productionVersionId: string | null
  rollbackVersionId: string | null
  overallStatus: PromotionGate['overallStatus']
  targetStage: PromotionGate['targetStage']
  blockingCheckLabels: string[]
  rollbackVersionLabel: string | null
}) {
  const router = useRouter()
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const [pending, setPending] = useState<PromotionAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const promoteDisabled = overallStatus !== 'ready'

  async function run(action: PromotionAction, versionId: string) {
    setPending(action)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}/promotion`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, versionId, previousProductionVersionId: productionVersionId }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(payload?.error ?? `Request failed (${res.status})`)
      }
      setRollbackOpen(false)
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-3">
      {promoteDisabled ? (
        // Blocked gate: the affordance must read disabled (outline, not a solid).
        <Button outline className="w-full" disabled>
          Promote to {targetStage}
        </Button>
      ) : (
        <Button
          color="accent"
          className="w-full"
          disabled={pending !== null}
          onClick={() => run('promote', candidateVersionId)}
        >
          {pending === 'promote' ? 'Promoting…' : `Promote to ${targetStage}`}
        </Button>
      )}
      {promoteDisabled && blockingCheckLabels.length > 0 ? (
        <p className="text-xs text-zinc-500">
          Promotion is blocked by: {blockingCheckLabels.join(', ')}. Resolve these checks to enable the button.
        </p>
      ) : null}

      <Button outline className="w-full" disabled title="Approval requests ship in V2">
        Request human approval
      </Button>

      {rollbackVersionLabel && rollbackVersionId ? (
        <Button plain className="w-full" disabled={pending !== null} onClick={() => setRollbackOpen(true)}>
          <span className="text-accent-600 dark:text-accent-400">
            Rollback to <span className="font-mono tabular-nums">{rollbackVersionLabel}</span>
          </span>
        </Button>
      ) : null}

      {error ? <p className="text-xs font-medium text-accent-600 dark:text-accent-400">{error}</p> : null}

      <Dialog open={rollbackOpen} onClose={setRollbackOpen} size="md">
        <DialogTitle>Rollback production?</DialogTitle>
        <DialogDescription>
          All production traffic would be routed back to{' '}
          <span className="font-mono tabular-nums">{rollbackVersionLabel}</span>. The current candidate stays in the
          gate and can be promoted again later.
        </DialogDescription>
        <DialogActions>
          <Button plain disabled={pending !== null} onClick={() => setRollbackOpen(false)}>
            Cancel
          </Button>
          <Button
            color="accent"
            disabled={pending !== null || !rollbackVersionId}
            onClick={() => rollbackVersionId && run('rollback', rollbackVersionId)}
          >
            {pending === 'rollback' ? 'Rolling back…' : 'Confirm rollback'}
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
