'use client'

import { useState } from 'react'

import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { PushAgentDialog } from '@/components/agent-ops/push-agent-dialog'
import { SoftAccentButton } from '@/components/agent-ops/soft-accent-link'
import { Text } from '@/components/catalyst/text'
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
  // Maturity gate mirrored from the push route (which now returns 422 when this
  // is null): we only publish tested-and-released runtime, so a copilot without
  // a promoted production version cannot be pushed. Gate the CTA before the click.
  const isReleased = copilot.productionVersionId !== null
  // Only an assigned copilot has a repo target; a bench copilot cannot push.
  const linkedProjectName =
    projectName ?? (copilot.projectId !== null ? projects.find((p) => p.id === copilot.projectId)?.name ?? null : null)

  return (
    <>
      {onBench ? (
        <SoftAccentButton onClick={() => setAssignTarget(copilot)}>Assign…</SoftAccentButton>
      ) : (
        <>
          {isReleased ? (
            <SoftAccentButton onClick={() => setPushTarget(copilot)}>Push to repo…</SoftAccentButton>
          ) : (
            // Doctrine: we only push tested-and-released runtime. Without a promoted
            // production version there is nothing to publish — a discreet, non-clickable
            // hint tells the operator to release first (clearer than a mystery-disabled button).
            <Text className="text-sm">Promote a production version to push</Text>
          )}
          <SoftAccentButton onClick={() => setUnassignTarget(copilot)}>Unassign…</SoftAccentButton>
        </>
      )}

      {pushTarget && pushTarget.projectId !== null && isReleased ? (
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
