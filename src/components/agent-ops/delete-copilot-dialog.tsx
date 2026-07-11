'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * Destructive confirm: permanently deletes a copilot and everything hanging off
 * it. Mirrors UnassignCopilotDialog's shape (useState pending/error, fetch +
 * messageForResponse, router.refresh() on success). Per doctrine the destructive
 * primary is a solid accent Button — the label carries the meaning.
 */
export function DeleteCopilotDialog({
  copilot,
  isOpen,
  onClose,
}: {
  copilot: Copilot
  isOpen: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setPending(true)
    setError(null)
    try {
      const res = await fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilot.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setError(await messageForResponse(res, 'Delete failed — the copilot was not removed.'))
        return
      }
      router.refresh()
      onClose()
    } catch {
      setError('Delete failed — the copilot was not removed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} size="md">
      <DialogTitle>Delete copilot</DialogTitle>
      <DialogDescription>
        This permanently deletes <span className="font-medium text-zinc-950 dark:text-white">{copilot.name}</span> and
        all of its versions, manifests, tools, tests, runs and benchmarks. This cannot be undone.
      </DialogDescription>
      {error ? <p className="mt-4 text-sm text-accent-600 dark:text-accent-400">{error}</p> : null}
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button color="accent" disabled={pending} onClick={remove}>
          {pending ? 'Deleting…' : 'Delete copilot'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
