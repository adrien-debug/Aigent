'use client'

import { XMarkIcon } from '@heroicons/react/16/solid'
import * as Headless from '@headlessui/react'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/catalyst/button'
import { Dialog, DialogActions, DialogBody, DialogDescription, DialogTitle } from '@/components/catalyst/dialog'
import { Field, Fieldset, Label } from '@/components/catalyst/fieldset'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { messageForResponse } from '@/lib/agent-mission-control/client-errors'
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
  const [success, setSuccess] = useState<string | null>(null)
  const [targetsPending, setTargetsPending] = useState(false)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) clearTimeout(closeTimerRef.current)
    }
  }, [])

  // Re-opening the dialog starts a fresh attempt — clear the previous receipt.
  // (Render-time state adjustment, per React's "you might not need an effect".)
  const [prevOpen, setPrevOpen] = useState(open)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSuccess(null)
      setError(null)
    }
  }

  const projectNameById = new Map(projects.map((project) => [project.id, project.name]))
  const addableProjects = projects.filter((project) => !targets.includes(project.id))
  const [addTargetId, setAddTargetId] = useState<string>('')

  function persistTargets(next: string[], previous: string[]) {
    setTargets(next)
    setTargetsPending(true)
    void persistCopilot(copilot.id, { targetProjectIds: next })
      .then((res) => {
        if (!res.ok) throw new Error(String(res.status))
        setError(null)
      })
      .catch(() => {
        // revert optimiste en cas d'échec réseau/serveur — et on le DIT.
        setTargets(previous)
        setError('Destination not saved — try again.')
      })
      .finally(() => {
        setTargetsPending(false)
      })
  }

  function addTarget() {
    if (targetsPending) return
    const id = addTargetId || addableProjects[0]?.id
    if (!id || targets.includes(id) || targets.length >= MAX_TARGETS) return
    setAddTargetId('')
    persistTargets([...targets, id], targets)
  }

  function removeTarget(id: string) {
    if (targetsPending) return
    persistTargets(targets.filter((targetId) => targetId !== id), targets)
  }

  async function validateAndAssign() {
    if (!selectedProjectId) return
    setSaving(true)
    setError(null)
    try {
      const res = await persistCopilot(copilot.id, { projectId: selectedProjectId })
      if (!res.ok) {
        setError(await messageForResponse(res, 'Assignment failed — the copilot stays on the bench.'))
        return
      }
      // Affirm the success inline before closing — the dialog closing alone is
      // not a receipt.
      setSuccess(`Assigned to ${projectNameById.get(selectedProjectId) ?? selectedProjectId} ✓`)
      router.refresh()
      closeTimerRef.current = setTimeout(() => {
        onClose()
      }, 1200)
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
        {copilot.healthEvidence === 'runs' ? (
          <>
            <span className="font-mono tabular-nums">{formatPercent(copilot.health.testPassRate)}</span> test pass
            {' · '}benchmark{' '}
            <span className="font-mono tabular-nums">{copilot.health.benchmarkScore}</span>/100.
          </>
        ) : (
          <span className="text-zinc-500 dark:text-zinc-400">not measured yet — no completed run.</span>
        )}
      </DialogDescription>
      <DialogBody>
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            No projects yet — create one first.{' '}
            <Link
              href="/admin/projects/new"
              className="font-medium text-zinc-950 underline decoration-zinc-950/30 hover:decoration-zinc-950 dark:text-white dark:decoration-white/30 dark:hover:decoration-white"
            >
              New project
            </Link>
          </p>
        ) : (
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
        )}

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
                  <Headless.Button
                    onClick={() => removeTarget(targetId)}
                    disabled={targetsPending}
                    className="-my-2 -mr-1 rounded-sm p-2 text-zinc-500 hover:text-zinc-950 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-500 disabled:opacity-50 dark:hover:text-white"
                  >
                    <XMarkIcon aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">Remove destination {projectNameById.get(targetId) ?? targetId}</span>
                  </Headless.Button>
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
              <Button outline onClick={addTarget} disabled={targetsPending}>
                {targetsPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          ) : null}
        </div>

        <div aria-live="polite">
          {success ? (
            <p className="mt-4 text-sm font-medium text-zinc-950 dark:text-white">{success}</p>
          ) : null}
        </div>
        {error ? <p className="mt-4 text-sm text-accent-600 dark:text-accent-400">{error}</p> : null}
      </DialogBody>
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button
          color="accent"
          disabled={saving || success !== null || projects.length === 0 || !selectedProjectId}
          onClick={validateAndAssign}
        >
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
      if (!res.ok) {
        setError(await messageForResponse(res, 'Unassign failed — the copilot keeps its project.'))
        return
      }
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
          <p className="text-sm font-medium text-accent-600 dark:text-accent-400">
            Warning: this copilot is active and serving a production version. Unassigning pulls a
            live copilot off its project.
          </p>
        </DialogBody>
      ) : null}
      {error ? <p className="mt-4 text-sm text-accent-600 dark:text-accent-400">{error}</p> : null}
      <DialogActions>
        <Button plain onClick={onClose}>
          Cancel
        </Button>
        <Button color="accent" disabled={saving} onClick={unassign}>
          {saving ? 'Unassigning…' : 'Unassign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
