'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Destructive confirm: permanently deletes a project and cascade-deletes every
 * copilot assigned to it. Same shape as DeleteCopilotDialog, but on success we
 * router.push('/admin/projects') — the deleted project's detail page must not
 * stay open. Per doctrine the destructive primary is a solid accent Button.
 */
export function DeleteProjectDialog({
  project,
  isOpen,
  onClose,
}: {
  project: Pick<Project, 'id' | 'name'>
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
      const res = await fetch(`/api/agent-ops/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        setError(await messageForResponse(res, 'Delete failed — the project was not removed.'))
        return
      }
      router.push('/admin/projects')
    } catch {
      setError('Delete failed — the project was not removed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={isOpen} onClose={onClose} size="md">
      <DialogTitle>Delete project</DialogTitle>
      <DialogDescription>
        This permanently deletes <span className="font-medium text-zinc-950 dark:text-white">{project.name}</span> and
        cascade-deletes every copilot assigned to it. This cannot be undone.
      </DialogDescription>
      {error ? <p className="mt-4 text-sm text-accent-600 dark:text-accent-400">{error}</p> : null}
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button color="accent" disabled={pending} onClick={remove}>
          {pending ? 'Deleting…' : 'Delete project'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
