'use client'

import { useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import type { PromotionGate } from '@/lib/agent-mission-control/types'

/**
 * Decision buttons for the promotion gate. UI-only in V1: promote is disabled
 * unless the gate is ready, approval request is a stub, and rollback opens a
 * confirmation dialog that performs no real action.
 */
export function PublishActions({
  overallStatus,
  targetStage,
  blockingCheckLabels,
  rollbackVersionLabel,
}: {
  overallStatus: PromotionGate['overallStatus']
  targetStage: PromotionGate['targetStage']
  blockingCheckLabels: string[]
  rollbackVersionLabel: string | null
}) {
  const [rollbackOpen, setRollbackOpen] = useState(false)
  const promoteDisabled = overallStatus !== 'ready'

  return (
    <div className="space-y-3">
      {promoteDisabled ? (
        // Blocked gate: the affordance must read disabled. Catalyst's disabled
        // opacity is too subtle on solid green in dark, so render the outline
        // variant instead of a saturated solid.
        <Button outline className="w-full" disabled>
          Promote to {targetStage}
        </Button>
      ) : (
        <Button color="accent" className="w-full">
          Promote to {targetStage}
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

      {rollbackVersionLabel ? (
        <Button plain className="w-full" onClick={() => setRollbackOpen(true)}>
          <span className="text-accent-600 dark:text-accent-400">
            Rollback to <span className="font-mono tabular-nums">{rollbackVersionLabel}</span>
          </span>
        </Button>
      ) : null}

      <Dialog open={rollbackOpen} onClose={setRollbackOpen} size="md">
        <DialogTitle>Rollback production?</DialogTitle>
        <DialogDescription>
          All production traffic would be routed back to{' '}
          <span className="font-mono tabular-nums">{rollbackVersionLabel}</span>. The current candidate stays in the
          gate and can be promoted again later.
        </DialogDescription>
        <DialogActions>
          <Button plain onClick={() => setRollbackOpen(false)}>
            Cancel
          </Button>
          <Button color="accent" onClick={() => setRollbackOpen(false)}>
            Confirm rollback
          </Button>
        </DialogActions>
      </Dialog>
    </div>
  )
}
