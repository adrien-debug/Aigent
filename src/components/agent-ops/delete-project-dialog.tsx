'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { ErrorBanner } from '@/components/agent-ops/authoring-primitives'
import { Button } from '@/components/ui/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { Description, Field, Label } from '@/components/ui/fieldset'
import { Input } from '@/components/ui/input'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
import type { Project } from '@/lib/agent-mission-control/types'

/**
 * Destructive confirm: permanently deletes a project and cascade-deletes every
 * copilot assigned to it. On success we router.push('/admin') — the deleted
 * project's detail page must not stay open.
 *
 * The dialog used to announce an irreversible cascade behind a solid accent
 * button, i.e. the SAME control as "Run Mission" on the page underneath: the
 * affordance for "destroy this project and all its agents" was pixel-identical
 * to the affordance for the page's happy path. Two guards now separate them:
 *   1. typed confirmation — the operator retypes the project name, so the act
 *      cannot be reached by muscle memory. The primary stays disabled until the
 *      text matches exactly;
 *   2. the `--state-danger-*` role on the primary and on the error, so the
 *      colour stops claiming success. The label and the typed name carry the
 *      meaning; the colour only reinforces it.
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
  const [confirmation, setConfirmation] = useState('')

  // Trailing whitespace comes free with a copy/paste of the name; everything
  // else must match character for character.
  const confirmed = confirmation.trim() === project.name

  /**
   * This component stays mounted while the dialog is closed, so the typed
   * confirmation would otherwise survive until the next open and re-arm the
   * delete button before the operator has typed anything.
   */
  function close() {
    setConfirmation('')
    setError(null)
    onClose()
  }

  async function remove() {
    if (!confirmed) return
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
      router.push('/admin')
    } catch {
      setError('Delete failed — the project was not removed.')
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={isOpen} onClose={close} size="md">
      <DialogTitle>Delete project</DialogTitle>
      <DialogDescription>
        This permanently deletes <span className="font-medium text-zinc-950 dark:text-white">{project.name}</span> and
        cascade-deletes every copilot assigned to it. This cannot be undone.
      </DialogDescription>
      <DialogBody>
        <Field disabled={pending}>
          <Label>Confirm the project name</Label>
          <Description>
            Type <span className="font-medium text-zinc-950 dark:text-white">{project.name}</span> exactly to enable the
            delete button.
          </Description>
          <Input
            name="confirm-project-name"
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={project.name}
          />
        </Field>
      </DialogBody>
      {error ? <ErrorBanner message={error} /> : null}
      <DialogActions>
        <Button plain disabled={pending} onClick={close}>
          Cancel
        </Button>
        <Button color="danger" disabled={pending || !confirmed} onClick={remove}>
          {pending ? 'Deleting…' : 'Delete project'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
