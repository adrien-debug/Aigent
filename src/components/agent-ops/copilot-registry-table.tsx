'use client'

import { EllipsisVerticalIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { useMemo, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Avatar } from '@/components/catalyst/avatar'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/catalyst/dropdown'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { formatPercent } from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { AgentRuntime, Copilot, CopilotStatus, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

const STATUS_LABELS: Record<CopilotStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
}

const RUNTIME_OPTIONS = Object.keys(AGENT_RUNTIME_LABELS) as AgentRuntime[]
const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as CopilotStatus[]

/** Two-letter initials from a copilot name, for the generated avatar. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function NameCell({ copilot }: { copilot: Copilot }) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <div className="flex items-center">
      <Avatar
        initials={initialsFor(copilot.name)}
        alt=""
        className="size-11 shrink-0 bg-zinc-800 text-white"
      />
      <div className="ml-4 min-w-0">
        <div className="truncate font-medium text-white">
          <Link href={href} title={copilot.name} className="hover:underline">
            {copilot.name}
          </Link>
        </div>
        <div className="mt-1 truncate font-mono text-xs text-zinc-500">{copilot.slug}</div>
      </div>
    </div>
  )
}

/**
 * Bench row — readiness first: tests, runs, destination target chips, and the
 * "Assign…" action that validates the copilot onto a project.
 */
function BenchRow({
  copilot,
  projectNameById,
  onAssign,
}: {
  copilot: Copilot
  projectNameById: Map<string, string>
  onAssign: (copilot: Copilot) => void
}) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <tr className="transition-colors duration-150 hover:bg-white/2.5">
      <td className="py-5 pr-3 pl-4 text-sm whitespace-nowrap sm:pl-0">
        <NameCell copilot={copilot} />
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap text-zinc-400">
        <div className="text-white">{AGENT_RUNTIME_LABELS[copilot.runtime]}</div>
        <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">{copilot.model}</div>
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap">
        <StatusBadge status={copilot.status} />
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap">
        {copilot.health.testPassRate === 0 ? (
          <div className="font-mono text-zinc-500 tabular-nums">
            <span aria-hidden="true">—</span>
            <span className="sr-only">not tested</span>
          </div>
        ) : (
          <div className="font-mono text-white tabular-nums">{formatPercent(copilot.health.testPassRate)}</div>
        )}
        <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">
          {copilot.health.benchmarkScore === 0 ? 'bench —' : `bench ${copilot.health.benchmarkScore}`}
        </div>
      </td>
      <td className="px-3 py-5 text-right text-sm whitespace-nowrap">
        <span className="font-mono text-zinc-300 tabular-nums">
          {copilot.health.runsLast24h.toLocaleString('en-US')}
        </span>
      </td>
      <td className="px-3 py-5 text-sm">
        {copilot.targetProjectIds.length === 0 ? (
          <span className="text-zinc-500">
            <span aria-hidden="true">—</span>
            <span className="sr-only">No destination project</span>
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1">
            {copilot.targetProjectIds.map((projectId) => (
              <Badge key={projectId} color="zinc">
                {projectNameById.get(projectId) ?? projectId}
              </Badge>
            ))}
          </div>
        )}
      </td>
      <td className="py-5 pr-4 pl-3 text-right text-sm font-medium whitespace-nowrap sm:pr-0">
        <div className="flex items-center justify-end gap-4">
          <Button outline onClick={() => onAssign(copilot)}>
            Assign…<span className="sr-only"> {copilot.name} to a project</span>
          </Button>
          <Link href={href} className="text-accent-400 hover:text-accent-300">
            Open<span className="sr-only">, {copilot.name}</span>
          </Link>
        </div>
      </td>
    </tr>
  )
}

/**
 * All-copilots row — project column (amber "On bench" when unassigned) and,
 * for assigned copilots only, a row menu carrying the guarded Unassign action.
 */
function AllRow({
  copilot,
  projectNameById,
  onUnassign,
}: {
  copilot: Copilot
  projectNameById: Map<string, string>
  onUnassign: (copilot: Copilot) => void
}) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <tr className="transition-colors duration-150 hover:bg-white/2.5">
      <td className="py-5 pr-3 pl-4 text-sm whitespace-nowrap sm:pl-0">
        <NameCell copilot={copilot} />
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap text-zinc-400">
        <div className="text-white">{AGENT_RUNTIME_LABELS[copilot.runtime]}</div>
        <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">{copilot.model}</div>
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap">
        <StatusBadge status={copilot.status} />
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap">
        {copilot.projectId === null ? (
          <Badge color="accentStrong">On bench</Badge>
        ) : (
          <span className="text-zinc-300">{projectNameById.get(copilot.projectId) ?? copilot.projectId}</span>
        )}
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap text-zinc-400">{copilot.owner}</td>
      <td className="py-5 pr-4 pl-3 text-right text-sm font-medium whitespace-nowrap sm:pr-0">
        <div className="flex items-center justify-end gap-2">
          <Link href={href} className="text-accent-400 hover:text-accent-300">
            Open<span className="sr-only">, {copilot.name}</span>
          </Link>
          {copilot.projectId !== null ? (
            <Dropdown>
              <DropdownButton plain aria-label={`Actions for ${copilot.name}`}>
                <EllipsisVerticalIcon />
              </DropdownButton>
              <DropdownMenu anchor="bottom end">
                <DropdownItem onClick={() => onUnassign(copilot)}>Unassign…</DropdownItem>
              </DropdownMenu>
            </Dropdown>
          ) : null}
        </div>
      </td>
    </tr>
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
  const columnCount = view === 'bench' ? 7 : 6

  function resetFilters() {
    setQuery('')
    setProjectId('all')
    setRuntime('all')
    setStatus('all')
  }

  function renderRow(copilot: Copilot) {
    return view === 'bench' ? (
      <BenchRow
        key={copilot.id}
        copilot={copilot}
        projectNameById={projectNameById}
        onAssign={setAssignTarget}
      />
    ) : (
      <AllRow
        key={copilot.id}
        copilot={copilot}
        projectNameById={projectNameById}
        onUnassign={setUnassignTarget}
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
                {STATUS_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <div className="mt-6">
        {filtered.length > 0 ? (
          <div className="flow-root">
            <div className="-mx-4 -my-2 overflow-x-auto sm:-mx-6 lg:-mx-8">
              <div className="inline-block min-w-full py-2 align-middle sm:px-6 lg:px-8">
                <table className="relative min-w-full divide-y divide-white/15">
                  <thead>
                    <tr>
                      <th scope="col" className="py-3.5 pr-3 pl-4 text-left text-sm font-semibold text-white sm:pl-0">
                        Name
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                        Runtime
                      </th>
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                        Status
                      </th>
                      {view === 'bench' ? (
                        <>
                          <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                            Tests
                          </th>
                          <th scope="col" className="px-3 py-3.5 text-right text-sm font-semibold text-white">
                            Runs 24h
                          </th>
                          <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                            Destination
                          </th>
                        </>
                      ) : (
                        <>
                          <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                            Project
                          </th>
                          <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                            Owner
                          </th>
                        </>
                      )}
                      <th scope="col" className="py-3.5 pr-4 pl-3 sm:pr-0">
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">{activeRows.map(renderRow)}</tbody>

                  {pausedRows.length > 0 ? (
                    <tbody className="divide-y divide-white/10 border-t border-white/15">
                      <tr>
                        <th
                          scope="colgroup"
                          colSpan={columnCount}
                          className="py-2 pr-3 pl-4 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase sm:pl-0"
                        >
                          Paused
                        </th>
                      </tr>
                      {pausedRows.map(renderRow)}
                    </tbody>
                  ) : null}
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg bg-zinc-950/5 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
              <MagnifyingGlassIcon aria-hidden="true" className="size-5 text-zinc-500 dark:text-zinc-400" />
            </span>
            <p className="mt-4 text-sm font-semibold text-zinc-950 dark:text-white">
              {view === 'bench' && scoped.length === 0 ? 'The bench is clear' : 'No copilots match'}
            </p>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              {view === 'bench' && scoped.length === 0
                ? 'Every copilot has been validated onto a project. New copilots land here while they are tested.'
                : "Adjust the search or clear the filters to find the copilot you're looking for."}
            </p>
            {view === 'bench' && scoped.length === 0 ? null : (
              <Button outline className="mt-6" onClick={resetFilters}>
                Reset filters
              </Button>
            )}
          </div>
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
    </AgentSectionCard>
  )
}
