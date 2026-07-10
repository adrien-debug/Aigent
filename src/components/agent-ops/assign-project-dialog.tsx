'use client'

import { XMarkIcon } from '@heroicons/react/16/solid'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Select } from '@/components/catalyst/select'
import { formatPercent } from '@/lib/agent-mission-control/format'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

const MAX_TARGETS = 2

function persistCopilot(copilotId: string, body: { projectId?: string | null; targetProjectIds?: string[] }) {
  return fetch(`/api/agent-ops/copilots/${encodeURIComponent(copilotId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * Validation-bench dialog: assigning a bench copilot to a project IS the
 * validation act. Primary zone = project Select + green "Validate & assign"
 * (PATCH { projectId } → router.refresh()). Secondary zone = destination dev
 * targets (0..2), edited optimistically via PATCH { targetProjectIds } with
 * revert on failure (same pattern as tool-permission-matrix).
 */
export function AssignProjectDialog({
  copilot,
  projects,
  open,
  onClose,
}: {
  copilot: Copilot
  projects: Project[]
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [selectedProjectId, setSelectedProjectId] = useState<string>(
    () => copilot.targetProjectIds[0] ?? projects[0]?.id ?? ''
  )
  const [targets, setTargets] = useState<string[]>(() => copilot.targetProjectIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const projectNameById = new Map(projects.map((project) => [project.id, project.name]))
  const addableProjects = projects.filter((project) => !targets.includes(project.id))
  const [addTargetId, setAddTargetId] = useState<string>('')

  function persistTargets(next: string[], previous: string[]) {
    setTargets(next)
    void persistCopilot(copilot.id, { targetProjectIds: next })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
      })
      .catch(() => {
        // revert optimiste en cas d'échec réseau/serveur
        setTargets(previous)
      })
  }

  function addTarget() {
    const id = addTargetId || addableProjects[0]?.id
    if (!id || targets.includes(id) || targets.length >= MAX_TARGETS) return
    setAddTargetId('')
    persistTargets([...targets, id], targets)
  }

  function removeTarget(id: string) {
    persistTargets(targets.filter((targetId) => targetId !== id), targets)
  }

  async function validateAndAssign() {
    if (!selectedProjectId) return
    setSaving(true)
    setError(null)
    try {
      const res = await persistCopilot(copilot.id, { projectId: selectedProjectId })
      if (!res.ok) throw new Error(String(res.status))
      router.refresh()
      onClose()
    } catch {
      setError('Assignment failed — the copilot stays on the bench.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="lg">
      <DialogTitle>Assign {copilot.name}</DialogTitle>
      <DialogDescription>
        Assigning to a project validates this copilot off the bench. Readiness:{' '}
        <span className="font-mono tabular-nums">{formatPercent(copilot.health.testPassRate)}</span> test pass
        {' · '}benchmark{' '}
        <span className="font-mono tabular-nums">{copilot.health.benchmarkScore}</span>/100.
      </DialogDescription>
      <DialogBody>
        <Fieldset>
          <Field>
            <Label>Assign to project</Label>
            <Select
              name="assign-project"
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        </Fieldset>

        <div className="mt-6 border-t border-zinc-950/5 pt-5 dark:border-white/5">
          <p className="text-sm font-medium text-zinc-950 dark:text-white">Destination (dev target)</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            Informational — the project(s) this copilot is being developed for ({MAX_TARGETS} max).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {targets.length === 0 ? (
              <span className="text-sm text-zinc-500">
                <span aria-hidden="true">—</span>
                <span className="sr-only">No destination projects</span>
              </span>
            ) : (
              targets.map((targetId) => (
                <span
                  key={targetId}
                  className="inline-flex items-center gap-1 rounded-md bg-zinc-950/5 py-0.5 pr-1 pl-2 text-xs text-zinc-700 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-300 dark:ring-white/10"
                >
                  {projectNameById.get(targetId) ?? targetId}
                  <button
                    type="button"
                    onClick={() => removeTarget(targetId)}
                    className="rounded-sm p-0.5 text-zinc-500 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-500 dark:hover:text-white"
                  >
                    <XMarkIcon aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Remove destination {projectNameById.get(targetId) ?? targetId}</span>
                  </button>
                </span>
              ))
            )}
          </div>
          {targets.length < MAX_TARGETS && addableProjects.length > 0 ? (
            <div className="mt-3 flex items-end gap-2">
              <Field className="min-w-0 flex-1">
                <Label className="sr-only">Add destination project</Label>
                <Select
                  name="add-destination"
                  value={addTargetId || addableProjects[0]?.id || ''}
                  onChange={(event) => setAddTargetId(event.target.value)}
                >
                  {addableProjects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button outline onClick={addTarget}>
                Add
              </Button>
            </div>
          ) : null}
        </div>

        {error ? <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button color="green" disabled={saving || !selectedProjectId} onClick={validateAndAssign}>
          {saving ? 'Assigning…' : 'Validate & assign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/**
 * Guardrail confirm: unassigning returns the copilot to the validation bench.
 * When the copilot is active AND serving a production version, an explicit
 * rose warning is shown before PATCH { projectId: null }.
 */
export function UnassignCopilotDialog({
  copilot,
  projectName,
  open,
  onClose,
}: {
  copilot: Copilot
  projectName: string | null
  open: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const servingProduction = copilot.status === 'active' && copilot.productionVersionId !== null

  async function unassign() {
    setSaving(true)
    setError(null)
    try {
      const res = await persistCopilot(copilot.id, { projectId: null })
      if (!res.ok) throw new Error(String(res.status))
      router.refresh()
      onClose()
    } catch {
      setError('Unassign failed — the copilot keeps its project.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} size="md">
      <DialogTitle>Unassign {copilot.name}?</DialogTitle>
      <DialogDescription>
        This removes the copilot from {projectName ?? 'its project'} and returns it to the validation
        bench — it is no longer validated.
      </DialogDescription>
      {servingProduction ? (
        <DialogBody>
          <p className="text-sm font-medium text-rose-600 dark:text-rose-400">
            Warning: this copilot is active and serving a production version. Unassigning pulls a
            live copilot off its project.
          </p>
        </DialogBody>
      ) : null}
      {error ? <p className="mt-4 text-sm text-rose-600 dark:text-rose-400">{error}</p> : null}
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button color="red" disabled={saving} onClick={unassign}>
          {saving ? 'Unassigning…' : 'Unassign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
