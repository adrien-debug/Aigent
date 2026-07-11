'use client'

import { useState } from 'react'

import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { Button } from '@/components/catalyst/button'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/**
 * Assign / Unassign actions for the copilot detail page — same dialogs and
 * mount pattern as the registry table (state target + `open` + `key`), so the
 * operator can act on the copilot without going back to the list.
 */
export function CopilotProjectActions({
  copilot,
  projects,
  projectName = null,
}: {
  copilot: Copilot
  projects: Project[]
  projectName?: string | null
}) {
  const [assignTarget, setAssignTarget] = useState<Copilot | null>(null)
  const [unassignTarget, setUnassignTarget] = useState<Copilot | null>(null)
  const onBench = copilot.projectId === null

  return (
    <>
      {onBench ? (
        <Button outline onClick={() => setAssignTarget(copilot)}>
          Assign…
        </Button>
      ) : (
        <Button plain onClick={() => setUnassignTarget(copilot)}>
          Unassign…
        </Button>
      )}

      {assignTarget ? (
        <AssignProjectDialog
          key={assignTarget.id}
          copilot={assignTarget}
          projects={projects}
          open
          onClose={() => setAssignTarget(null)}
        />
      ) : null}
      {unassignTarget ? (
        <UnassignCopilotDialog
          key={unassignTarget.id}
          copilot={unassignTarget}
          projectName={projectName}
          open
          onClose={() => setUnassignTarget(null)}
        />
      ) : null}
    </>
  )
}
