'use client'

import { EllipsisVerticalIcon, FolderIcon, MagnifyingGlassIcon } from '@heroicons/react/16/solid'
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
import { Subheading } from '@/components/catalyst/heading'
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

// Card shell — SAME skeleton as the project card (project-card.tsx): gradient
// header, avatar overlapping its bottom edge, body with title/meta/description
// on fixed heights, a bordered stat footer, then the action bar. Twin cards
// align to the pixel; absent data renders "—", never 0.
const CARD_SHELL =
  'col-span-1 flex h-full flex-col overflow-hidden rounded-xl bg-white ring-1 transition-shadow duration-150 dark:bg-zinc-950'

/** One footer stat — label over a mono value; "—" (zinc) when unmeasured. */
function Stat({ label, value, measured }: { label: string; value: string; measured: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div
        className={
          'mt-1 font-mono tabular-nums ' + (measured ? 'text-zinc-700 dark:text-zinc-200' : 'text-zinc-500')
        }
      >
        {measured ? value : <span aria-hidden="true">&mdash;</span>}
        {!measured ? <span className="sr-only">not measured</span> : null}
      </div>
    </div>
  )
}

/** The identity header: a zinc gradient banner + the round copilot avatar
 *  overlapping its bottom edge (mirrors the project card's photo + logo). */
function CopilotBanner({ copilot }: { copilot: Copilot }) {
  return (
    <>
      <div className="relative h-14">
        <div aria-hidden="true" className="size-full bg-gradient-to-br from-zinc-800 to-zinc-950" />
        <div className="absolute top-2.5 right-2.5 z-10">
          <Badge color={STATUS_BADGE_COLOR[copilot.status]} className="shadow-sm">
            {COPILOT_STATUS_LABELS[copilot.status]}
          </Badge>
        </div>
      </div>
      <div className="relative z-10 -mt-6 ml-5">
        <CopilotAvatar copilot={copilot} className="size-12 ring-2 ring-white dark:ring-zinc-950" />
      </div>
    </>
  )
}

/**
 * Card body — mirrors the project card's body exactly: title, meta line, the
 * project context, a fixed-height description, a bordered stat footer, then the
 * Open / Improve / menu action bar. `children` are the extra dropdown items.
 */
function CopilotCardBody({
  copilot,
  href,
  contextLabel,
  contextMuted,
  children,
}: {
  copilot: Copilot
  href: string
  contextLabel: string
  contextMuted: boolean
  children: ReactNode
}) {
  const tested = copilot.health.testPassRate > 0
  const benched = copilot.health.benchmarkScore > 0
  const hasRuns = copilot.health.runsLast24h > 0
  return (
    <div className="flex flex-1 flex-col px-5 pt-2.5 pb-5">
      <Subheading level={3} tone="neutral" className="truncate">
        <Link href={href} title={copilot.name} className="hover:underline">
          {copilot.name}
        </Link>
      </Subheading>
      <div className="mt-1 truncate font-mono text-xs text-zinc-500">
        {MODEL_PROVIDER_LABELS[copilot.modelProvider]} · {AGENT_RUNTIME_LABELS[copilot.runtime]} · {copilot.slug}
      </div>
      {/* The project (or bench) — an accent folder pill so it's never lost. */}
      <div className="mt-2">
        <span
          className={
            'inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium ' +
            (contextMuted
              ? 'bg-zinc-950/5 text-zinc-500 dark:bg-white/5 dark:text-zinc-400'
              : 'bg-[var(--accent-surface)] text-accent-700 ring-1 ring-[var(--accent-line)] dark:text-accent-300')
          }
        >
          <FolderIcon aria-hidden="true" className="size-3.5 shrink-0" />
          <span className="truncate">{contextLabel}</span>
        </span>
      </div>
      {/* Fixed 2-line description height so twin cards align their footers. */}
      <p className="mt-3 line-clamp-2 min-h-10 text-sm text-zinc-500 dark:text-zinc-400">{copilot.description}</p>

      {/* Footer — three mini-stats, same slots as the project card. */}
      <div className="mt-auto grid grid-cols-3 gap-4 border-t border-zinc-950/5 pt-4 dark:border-white/5">
        <Stat label="Tests" value={formatPercent(copilot.health.testPassRate)} measured={tested} />
        <Stat label="Benchmark" value={copilot.health.benchmarkScore.toFixed(1)} measured={benched} />
        <Stat label="Runs 24h" value={String(copilot.health.runsLast24h)} measured={hasRuns} />
      </div>

      {/* Actions. */}
      <div className="mt-4 flex items-center gap-2">
        <Button href={href} color="accent">
          Open<span className="sr-only">, {copilot.name}</span>
        </Button>
        <Button href={`${href}/improve`} outline>
          Improve<span className="sr-only"> {copilot.name}</span>
        </Button>
        <Dropdown>
          <DropdownButton plain aria-label={`More actions for ${copilot.name}`} className="ml-auto shrink-0">
            <EllipsisVerticalIcon />
          </DropdownButton>
          <DropdownMenu anchor="bottom end">{children}</DropdownMenu>
        </Dropdown>
      </div>
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
  const destinations = copilot.targetProjectIds.map((projectId) => projectNameById.get(projectId) ?? projectId)
  return (
    <li className={`${CARD_SHELL} ${cardShellClass(copilot.status)}`}>
      <CopilotBanner copilot={copilot} />
      <CopilotCardBody
        copilot={copilot}
        href={href}
        contextLabel={destinations.length === 0 ? 'No destination yet' : destinations.join(' · ')}
        contextMuted={destinations.length === 0}
      >
        <DropdownItem onClick={() => onAssign(copilot)}>Assign…</DropdownItem>
        <DropdownItem href={`${href}/runs`}>Runs</DropdownItem>
        <DropdownItem href={`${href}/tests`}>Tests</DropdownItem>
        <DropdownItem href={`${href}/manifest`}>Config</DropdownItem>
        <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
      </CopilotCardBody>
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
      <CopilotBanner copilot={copilot} />
      <CopilotCardBody
        copilot={copilot}
        href={href}
        contextLabel={copilot.projectId === null ? 'Validation bench' : (projectNameById.get(copilot.projectId) ?? copilot.projectId)}
        contextMuted={copilot.projectId === null}
      >
        <DropdownItem href={`${href}/runs`}>Runs</DropdownItem>
        <DropdownItem href={`${href}/tests`}>Tests</DropdownItem>
        <DropdownItem href={`${href}/manifest`}>Config</DropdownItem>
        {copilot.projectId !== null ? (
          <DropdownItem onClick={() => onUnassign(copilot)}>Unassign…</DropdownItem>
        ) : null}
        <DropdownItem onClick={() => onDelete(copilot)}>Delete…</DropdownItem>
      </CopilotCardBody>
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
            <ul role="list" className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {activeRows.map(renderCard)}
            </ul>

            {pausedRows.length > 0 ? (
              <div>
                <h3 className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Paused</h3>
                <ul role="list" className="mt-3 grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
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
