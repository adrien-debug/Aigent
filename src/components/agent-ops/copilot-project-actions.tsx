'use client'

import { useState } from 'react'

import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { PushAgentDialog } from '@/components/agent-ops/push-agent-dialog'
import { SoftAccentButton } from '@/components/agent-ops/soft-accent-link'
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
  const [pushTarget, setPushTarget] = useState<Copilot | null>(null)
  const onBench = copilot.projectId === null
  // Only an assigned copilot has a repo target; a bench copilot cannot push.
  const linkedProjectName =
    projectName ?? (copilot.projectId !== null ? projects.find((p) => p.id === copilot.projectId)?.name ?? null : null)

  return (
    <>
      {onBench ? (
        <SoftAccentButton onClick={() => setAssignTarget(copilot)}>Assign…</SoftAccentButton>
      ) : (
        <>
          <SoftAccentButton onClick={() => setPushTarget(copilot)}>Push to repo…</SoftAccentButton>
          <SoftAccentButton onClick={() => setUnassignTarget(copilot)}>Unassign…</SoftAccentButton>
        </>
      )}

      {pushTarget && pushTarget.projectId !== null ? (
        <PushAgentDialog
          key={`push-${pushTarget.id}`}
          copilot={pushTarget}
          projectId={pushTarget.projectId}
          projectName={linkedProjectName}
          open
          onClose={() => setPushTarget(null)}
        />
      ) : null}

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
