'use client'

import { EllipsisVerticalIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { type ReactNode, useMemo, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { AssignProjectDialog, UnassignCopilotDialog } from '@/components/agent-ops/assign-project-dialog'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { DeleteCopilotDialog } from '@/components/agent-ops/delete-copilot-dialog'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { Badge } from '@/components/catalyst/badge'
import { Button } from '@/components/catalyst/button'
import { Dropdown, DropdownButton, DropdownItem, DropdownMenu } from '@/components/catalyst/dropdown'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { formatPercent } from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS, COPILOT_STATUS_LABELS, MODEL_PROVIDER_LABELS } from '@/lib/agent-mission-control/labels'
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

/** Card chrome shared by both variants — accent ring + glow only for 'active'. */
function cardShellClass(status: CopilotStatus): string {
  return status === 'active'
    ? 'ring-[var(--accent-line)] shadow-[0_0_0_1px_var(--accent-line)_inset,0_8px_24px_-12px_var(--accent-glow)] dark:shadow-[0_0_0_1px_var(--accent-line)_inset,0_8px_24px_-12px_var(--accent-glow)]'
    : 'ring-zinc-950/10 dark:ring-white/10'
}

// Shared card shell — single p-4, no inner divides. The boxy 2-col stat strip
// that made copilots read like project cards is gone; gap-3 stacks the identity
// block, the metric line, a context line and the compact action toolbar.
const CARD_SHELL =
  'col-span-1 flex flex-col gap-3 rounded-xl bg-zinc-950/2.5 p-4 ring-1 transition-shadow duration-150 dark:bg-white/2.5'

/** Provider · runtime · tests · benchmark — the operator metric line. */
function CopilotMeta({ copilot }: { copilot: Copilot }) {
  const sep = (
    <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
      ·
    </span>
  )
  return (
    <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-zinc-500">
      <span>{MODEL_PROVIDER_LABELS[copilot.modelProvider]}</span>
      {sep}
      <span>{AGENT_RUNTIME_LABELS[copilot.runtime]}</span>
      {sep}
      <span className="tabular-nums">
        {copilot.health.testPassRate > 0 ? `${formatPercent(copilot.health.testPassRate)} tests` : 'untested'}
      </span>
      {sep}
      <span className="tabular-nums">
        {copilot.health.benchmarkScore > 0 ? `bench ${copilot.health.benchmarkScore.toFixed(1)}` : 'no benchmark'}
      </span>
    </div>
  )
}

/** Type-glyph avatar + name + status badge + role + slug — the identity block. */
function CopilotCardHeader({ copilot, href }: { copilot: Copilot; href: string }) {
  return (
    <div className="flex items-start gap-3">
      <CopilotAvatar copilot={copilot} />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <Link
            href={href}
            title={copilot.name}
            className="truncate text-sm font-semibold text-zinc-950 hover:underline dark:text-white"
          >
            {copilot.name}
          </Link>
          <Badge color={STATUS_BADGE_COLOR[copilot.status]} className="ml-auto shrink-0">
            {COPILOT_STATUS_LABELS[copilot.status]}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">{copilot.description}</p>
        <p className="truncate font-mono text-xs text-zinc-500">{copilot.slug}</p>
      </div>
    </div>
  )
}

/** Open / Improve up front, everything else in a compact menu. */
function CopilotActionBar({
  href,
  copilotName,
  children,
}: {
  href: string
  copilotName: string
  children: ReactNode
}) {
  return (
    <div className="mt-auto flex items-center gap-2 pt-1">
      <Button href={href} color="accent">
        Open<span className="sr-only">, {copilotName}</span>
      </Button>
      <Button href={`${href}/improve`} outline>
        Improve<span className="sr-only"> {copilotName}</span>
      </Button>
      <Dropdown>
        <DropdownButton plain aria-label={`More actions for ${copilotName}`} className="ml-auto shrink-0">
          <EllipsisVerticalIcon />
        </DropdownButton>
        <DropdownMenu anchor="bottom end">{children}</DropdownMenu>
      </Dropdown>
    </div>
  )
}

/**
 * Bench card — an operator on the validation bench. Identity + metrics, the
 * intended destination, then Open / Improve with the rest (Assign, Runs, Tests,
 * Config, Delete) folded into the menu.
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
    <li className={`${CARD_SHELL} ${cardShellClass(copilot.status)}`}>
      <CopilotCardHeader copilot={copilot} href={href} />
      <CopilotMeta copilot={copilot} />
      <p className="truncate text-xs text-zinc-500">
        <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
          →{' '}
        </span>
        {copilot.targetProjectIds.length === 0 ? (
          <span>no destination yet</span>
        ) : (
          <span className="text-zinc-600 dark:text-zinc-300">
            {copilot.targetProjectIds.map((projectId) => projectNameById.get(projectId) ?? projectId).join(' · ')}
          </span>
        )}
      </p>
      <CopilotActionBar href={href} copilotName={copilot.name}>
        <DropdownItem onClick={() => onAssign(copilot)}>Assign…</DropdownItem>
        <DropdownItem href={`${href}/runs`}>Runs</DropdownItem>
        <DropdownItem href={`${href}/tests`}>Tests</DropdownItem>
        <DropdownItem href={`${href}/manifest`}>Config</DropdownItem>
        <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
      </CopilotActionBar>
    </li>
  )
}

/**
 * All-copilots card — same compact operator shell; the context line shows the
 * project (or "On the validation bench") and owner, and the menu carries the
 * guarded Unassign action for assigned copilots.
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
    <li className={`${CARD_SHELL} ${cardShellClass(copilot.status)}`}>
      <CopilotCardHeader copilot={copilot} href={href} />
      <CopilotMeta copilot={copilot} />
      <p className="truncate text-xs text-zinc-500">
        {copilot.projectId === null ? (
          <span>On the validation bench</span>
        ) : (
          <span className="text-zinc-600 dark:text-zinc-300">
            {projectNameById.get(copilot.projectId) ?? copilot.projectId}
          </span>
        )}
        <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
          {' · '}
        </span>
        <span>{copilot.owner}</span>
      </p>
      <CopilotActionBar href={href} copilotName={copilot.name}>
        <DropdownItem href={`${href}/runs`}>Runs</DropdownItem>
        <DropdownItem href={`${href}/tests`}>Tests</DropdownItem>
        <DropdownItem href={`${href}/manifest`}>Config</DropdownItem>
        {copilot.projectId !== null ? (
          <DropdownItem onClick={() => onUnassign(copilot)}>Unassign…</DropdownItem>
        ) : null}
        <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
      </CopilotActionBar>
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
