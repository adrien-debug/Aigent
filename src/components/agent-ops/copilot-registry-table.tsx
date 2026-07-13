'use client'

import { EllipsisVerticalIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import * as Headless from '@headlessui/react'
import { useMemo, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { DeleteCopilotDialog } from '@/components/agent-ops/delete-copilot-dialog'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { Avatar } from '@/components/catalyst/avatar'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/catalyst/dropdown'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { formatPercent } from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS, COPILOT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRuntime, Copilot, CopilotStatus, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

const RUNTIME_OPTIONS = Object.keys(AGENT_RUNTIME_LABELS) as AgentRuntime[]
const STATUS_OPTIONS = Object.keys(COPILOT_STATUS_LABELS) as CopilotStatus[]

// Mono-accent ladder only (see badge.tsx) — 'active' is the one state that
// earns the solid accent, everything else stays on the zinc/soft rungs.
const STATUS_BADGE_COLOR: Record<CopilotStatus, 'accentSolid' | 'accentStrong' | 'zinc'> = {
  active: 'accentSolid',
  degraded: 'accentStrong',
  draft: 'zinc',
  paused: 'zinc',
  archived: 'zinc',
}

// Small live-state dot next to the name — same ladder as the badge, just a
// glance-able signal before the eye even reaches the label.
const STATUS_DOT_COLOR: Record<CopilotStatus, string> = {
  active: 'bg-accent-500',
  degraded: 'bg-accent-500/70',
  draft: 'bg-zinc-400 dark:bg-zinc-600',
  paused: 'bg-zinc-400 dark:bg-zinc-600',
  archived: 'bg-zinc-400 dark:bg-zinc-600',
}

/** Two-letter initials from a copilot name, for the generated avatar. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Card chrome shared by both variants — accent ring + glow only for 'active'. */
function cardShellClass(status: CopilotStatus): string {
  return status === 'active'
    ? 'ring-[var(--accent-line)] shadow-[0_0_0_1px_var(--accent-line)_inset,0_8px_24px_-12px_var(--accent-glow)] dark:shadow-[0_0_0_1px_var(--accent-line)_inset,0_8px_24px_-12px_var(--accent-glow)]'
    : 'ring-zinc-950/10 dark:ring-white/10'
}

/**
 * Bench card — readiness first: tests, runs, destination target chips, and
 * the "Assign…" action that validates the copilot onto a project.
 */
function BenchCard({
  copilot,
  projectNameById,
  onAssign,
  onDelete,
}: {
  copilot: Copilot
  projectNameById: Map<string, string>
  onAssign: (copilot: Copilot) => void
  onDelete: (copilot: Copilot) => void
}) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <li
      className={`col-span-1 divide-y divide-zinc-950/10 rounded-xl bg-zinc-950/2.5 ring-1 transition-shadow duration-150 dark:divide-white/10 dark:bg-white/2.5 ${cardShellClass(copilot.status)}`}
    >
      <div className="flex w-full items-start gap-x-4 p-6">
        <Avatar
          initials={initialsFor(copilot.name)}
          alt=""
          className="size-12 shrink-0 bg-zinc-800 text-base font-semibold text-white ring-1 ring-zinc-950/10 dark:ring-white/10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT_COLOR[copilot.status]}`} aria-hidden="true" />
            <Link
              href={href}
              title={copilot.name}
              className="truncate text-base font-semibold text-zinc-950 hover:underline dark:text-white"
            >
              {copilot.name}
            </Link>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{copilot.slug}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge color={STATUS_BADGE_COLOR[copilot.status]}>{COPILOT_STATUS_LABELS[copilot.status]}</Badge>
            <Badge color="zinc">{AGENT_RUNTIME_LABELS[copilot.runtime]}</Badge>
          </div>
          <p className="mt-1.5 truncate font-mono text-xs text-zinc-500">{copilot.model}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px divide-x divide-zinc-950/10 border-t border-zinc-950/10 text-center dark:divide-white/10 dark:border-white/10">
        <div className="px-4 py-3.5">
          <div className="text-xs text-zinc-500">Tests</div>
          {copilot.health.testPassRate === 0 ? (
            <div className="mt-1 font-mono text-sm text-zinc-500 tabular-nums">
              <span aria-hidden="true">—</span>
              <span className="sr-only">not tested</span>
            </div>
          ) : (
            <div className="mt-1 font-mono text-sm font-medium text-zinc-950 tabular-nums dark:text-white">
              {formatPercent(copilot.health.testPassRate)}
            </div>
          )}
        </div>
        <div className="px-4 py-3.5">
          <div className="text-xs text-zinc-500">Runs 24h</div>
          <div className="mt-1 font-mono text-sm font-medium text-zinc-950 tabular-nums dark:text-white">
            {copilot.health.runsLast24h.toLocaleString('en-US')}
          </div>
        </div>
      </div>
      <div className="px-6 py-3.5">
        <div className="text-xs text-zinc-500">Destination</div>
        <div className="mt-1 truncate text-sm">
          {copilot.targetProjectIds.length === 0 ? (
            <span className="text-zinc-500">
              <span aria-hidden="true">—</span>
              <span className="sr-only">No destination project</span>
            </span>
          ) : (
            <span className="text-zinc-700 dark:text-zinc-300">
              {copilot.targetProjectIds.map((projectId) => projectNameById.get(projectId) ?? projectId).join(' · ')}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 p-3">
        <Headless.Button
          onClick={() => onAssign(copilot)}
          className="inline-flex flex-1 items-center justify-center rounded-lg bg-[var(--accent-soft)] px-3 py-2 text-sm font-medium text-accent-700 ring-1 ring-[var(--accent-line)] transition-colors hover:bg-[var(--accent-surface)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-300"
        >
          Assign…<span className="sr-only"> {copilot.name} to a project</span>
        </Headless.Button>
        <Button href={href} color="accent" className="flex-1 justify-center">
          Open<span className="sr-only">, {copilot.name}</span>
        </Button>
        <Dropdown>
          <DropdownButton plain aria-label={`Actions for ${copilot.name}`} className="shrink-0">
            <EllipsisVerticalIcon />
          </DropdownButton>
          <DropdownMenu anchor="bottom end">
            <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </li>
  )
}

/**
 * All-copilots card — project line (amber "On bench" when unassigned) and,
 * for assigned copilots only, a menu carrying the guarded Unassign action.
 */
function AllCard({
  copilot,
  projectNameById,
  onUnassign,
  onDelete,
}: {
  copilot: Copilot
  projectNameById: Map<string, string>
  onUnassign: (copilot: Copilot) => void
  onDelete: (copilot: Copilot) => void
}) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <li
      className={`col-span-1 divide-y divide-zinc-950/10 rounded-xl bg-zinc-950/2.5 ring-1 transition-shadow duration-150 dark:divide-white/10 dark:bg-white/2.5 ${cardShellClass(copilot.status)}`}
    >
      <div className="flex w-full items-start gap-x-4 p-6">
        <Avatar
          initials={initialsFor(copilot.name)}
          alt=""
          className="size-12 shrink-0 bg-zinc-800 text-base font-semibold text-white ring-1 ring-zinc-950/10 dark:ring-white/10"
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <span className={`size-1.5 shrink-0 rounded-full ${STATUS_DOT_COLOR[copilot.status]}`} aria-hidden="true" />
            <Link
              href={href}
              title={copilot.name}
              className="truncate text-base font-semibold text-zinc-950 hover:underline dark:text-white"
            >
              {copilot.name}
            </Link>
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-zinc-500">{copilot.slug}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge color={STATUS_BADGE_COLOR[copilot.status]}>{COPILOT_STATUS_LABELS[copilot.status]}</Badge>
            <Badge color="zinc">{AGENT_RUNTIME_LABELS[copilot.runtime]}</Badge>
          </div>
          <p className="mt-1.5 truncate font-mono text-xs text-zinc-500">{copilot.model}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px divide-x divide-zinc-950/10 border-t border-zinc-950/10 text-center dark:divide-white/10 dark:border-white/10">
        <div className="px-4 py-3.5">
          <div className="text-xs text-zinc-500">Project</div>
          <div className="mt-1 truncate text-sm">
            {copilot.projectId === null ? (
              <span className="text-zinc-500">On bench</span>
            ) : (
              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                {projectNameById.get(copilot.projectId) ?? copilot.projectId}
              </span>
            )}
          </div>
        </div>
        <div className="px-4 py-3.5">
          <div className="text-xs text-zinc-500">Owner</div>
          <div className="mt-1 truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">{copilot.owner}</div>
        </div>
      </div>
      <div className="flex items-center gap-2 p-3">
        <Button href={href} color="accent" className="flex-1 justify-center">
          Open<span className="sr-only">, {copilot.name}</span>
        </Button>
        <Dropdown>
          <DropdownButton plain aria-label={`Actions for ${copilot.name}`} className="shrink-0">
            <EllipsisVerticalIcon />
          </DropdownButton>
          <DropdownMenu anchor="bottom end">
            {copilot.projectId !== null ? (
              <DropdownItem onClick={() => onUnassign(copilot)}>Unassign…</DropdownItem>
            ) : null}
            <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
          </DropdownMenu>
        </Dropdown>
      </div>
    </li>
  )
}

/**
 * Filterable copilot registry table. Two views (toggled from RegistryView):
 * the VALIDATION BENCH (projectId === null — copilots being tested/tuned, not
 * yet validated; assigning to a project IS the validation act) and ALL
 * copilots. Paused copilots are pulled into a separate section at the bottom.
 */
export function CopilotRegistryTable({
  copilots,
  projects,
  view = 'all',
}: {
  copilots: Copilot[]
  projects: Project[]
  view?: RegistryTableView
}) {
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState<string>('all')
  const [runtime, setRuntime] = useState<AgentRuntime | 'all'>('all')
  const [status, setStatus] = useState<CopilotStatus | 'all'>('all')
  const [assignTarget, setAssignTarget] = useState<Copilot | null>(null)
  const [unassignTarget, setUnassignTarget] = useState<Copilot | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Copilot | null>(null)

  const projectNameById = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects])
  const scoped = useMemo(
    () => (view === 'bench' ? copilots.filter((copilot) => copilot.projectId === null) : copilots),
    [copilots, view]
  )

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return scoped.filter((copilot) => {
      if (view === 'all' && projectId !== 'all' && copilot.projectId !== projectId) return false
      if (runtime !== 'all' && copilot.runtime !== runtime) return false
      if (status !== 'all' && copilot.status !== status) return false
      if (needle.length > 0) {
        const haystack = `${copilot.name} ${copilot.slug} ${copilot.owner} ${copilot.model}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [scoped, view, query, projectId, runtime, status])

  // Pull paused copilots out of the main list into a separate section.
  const activeRows = filtered.filter((copilot) => copilot.status !== 'paused')
  const pausedRows = filtered.filter((copilot) => copilot.status === 'paused')

  function resetFilters() {
    setQuery('')
    setProjectId('all')
    setRuntime('all')
    setStatus('all')
  }

  function renderCard(copilot: Copilot) {
    return view === 'bench' ? (
      <BenchCard
        key={copilot.id}
        copilot={copilot}
        projectNameById={projectNameById}
        onAssign={setAssignTarget}
        onDelete={setDeleteTarget}
      />
    ) : (
      <AllCard
        key={copilot.id}
        copilot={copilot}
        projectNameById={projectNameById}
        onUnassign={setUnassignTarget}
        onDelete={setDeleteTarget}
      />
    )
  }

  return (
    <AgentSectionCard
      title={view === 'bench' ? 'Validation bench' : 'Copilot registry'}
      description={
        view === 'bench'
          ? 'Copilots being tested and tuned — assigning one to a project is the validation act.'
          : 'Every copilot — assigned to a project or still on the validation bench.'
      }
      actions={
        <span className="text-xs text-zinc-500 tabular-nums">
          {filtered.length} of {scoped.length}
        </span>
      }
    >
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${view === 'bench' ? 'xl:grid-cols-3' : 'xl:grid-cols-4'}`}
      >
        <Field>
          <Label>Search</Label>
          <InputGroup>
            <MagnifyingGlassIcon />
            <Input
              type="search"
              name="registry-search"
              placeholder="Name, slug, owner or model"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </InputGroup>
        </Field>
        {view === 'all' ? (
          <Field>
            <Label>Project</Label>
            <Select name="registry-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="all">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field>
          <Label>Runtime</Label>
          <Select
            name="registry-runtime"
            value={runtime}
            onChange={(event) => setRuntime(event.target.value as AgentRuntime | 'all')}
          >
            <option value="all">All runtimes</option>
            {RUNTIME_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {AGENT_RUNTIME_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
        <Field>
          <Label>Status</Label>
          <Select
            name="registry-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as CopilotStatus | 'all')}
          >
            <option value="all">All statuses</option>
            {STATUS_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {COPILOT_STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-6">
        {filtered.length > 0 ? (
          <div className="space-y-8">
            <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {activeRows.map(renderCard)}
            </ul>

            {pausedRows.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Paused</h3>
                <ul role="list" className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {pausedRows.map(renderCard)}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <EmptyState
            icon={MagnifyingGlassIcon}
            title={view === 'bench' && scoped.length === 0 ? 'The bench is clear' : 'No copilots match'}
            description={
              view === 'bench' && scoped.length === 0
                ? 'Every copilot has been validated onto a project. New copilots land here while they are tested.'
                : "Adjust the search or clear the filters to find the copilot you're looking for."
            }
            action={
              view === 'bench' && scoped.length === 0 ? undefined : (
                <Button outline onClick={resetFilters}>
                  Reset filters
                </Button>
              )
            }
          />
        )}
      </div>

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
          projectName={
            unassignTarget.projectId ? (projectNameById.get(unassignTarget.projectId) ?? null) : null
          }
          open
          onClose={() => setUnassignTarget(null)}
        />
      ) : null}
      {deleteTarget ? (
        <DeleteCopilotDialog
          key={deleteTarget.id}
          copilot={deleteTarget}
          isOpen
          onClose={() => setDeleteTarget(null)}
        />
      ) : null}
    </AgentSectionCard>
  )
}
