'use client'

import clsx from 'clsx'
import { EllipsisVerticalIcon, FolderIcon, MagnifyingGlassIcon, ArrowRightIcon, CheckCircleIcon, ExclamationTriangleIcon, PauseCircleIcon, DocumentTextIcon, ArchiveBoxIcon } from '@heroicons/react/16/solid'
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
import { AGENT_RUNTIME_LABELS, COPILOT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRuntime, Copilot, CopilotStatus, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

const RUNTIME_OPTIONS = Object.keys(AGENT_RUNTIME_LABELS) as AgentRuntime[]
const STATUS_OPTIONS = Object.keys(COPILOT_STATUS_LABELS) as CopilotStatus[]

// Mono-accent ladder only (see badge.tsx) — 'active' is the one state that
// earns the solid accent, everything else stays on the zinc/soft rungs.
const STATUS_ICONS: Record<CopilotStatus, React.ElementType> = {
  active: CheckCircleIcon,
  degraded: ExclamationTriangleIcon,
  paused: PauseCircleIcon,
  draft: DocumentTextIcon,
  archived: ArchiveBoxIcon,
}

const STATUS_ICON_CLASS: Record<CopilotStatus, string> = {
  active: 'flex items-center justify-center text-accent-500 dark:text-accent-400 drop-shadow-[0_0_8px_var(--accent-glow)]',
  degraded: 'flex items-center justify-center text-zinc-600 dark:text-zinc-400',
  draft: 'flex items-center justify-center text-zinc-400 dark:text-zinc-600',
  paused: 'flex items-center justify-center text-zinc-400 dark:text-zinc-600',
  archived: 'flex items-center justify-center text-zinc-400 dark:text-zinc-600',
}

/** Card chrome shared by both variants — accent ring + glow only for 'active'. */
function cardShellClass(status: CopilotStatus): string {
  return status === 'active'
    ? 'ring-1 ring-(--accent-line) shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_0_20px_-5px_var(--accent-glow)] dark:ring-(--accent-line) dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_0_20px_-5px_var(--accent-glow)]'
    : ''
}

// Card shell — a COMPACT list card (4-up grid): a small avatar + name + status
// on one row, the project pill, one condensed metric line, then the action bar.
// No banner, no description — the detail lives on the agent's own page.
const CARD_SHELL =
  'group relative col-span-1 flex h-[190px] flex-col overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-zinc-950/5 transition-all duration-300 hover:shadow-lg hover:ring-zinc-950/10 dark:bg-zinc-950 dark:ring-white/5 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] dark:hover:ring-white/10 dark:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.02),0_10px_40px_-10px_rgba(0,0,0,0.3)]'

/**
 * Compact card body: avatar + name + status on one line, project pill, a single
 * tests · bench · runs metric line, then Open / menu. `children` = dropdown items.
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
  const runs = copilot.health.runsLast24h
  
  // Custom abstract visual representation per copilot ID
  const seed = parseInt(copilot.id.replace(/\D/g, '').slice(0, 8) || '1')
  const variant = seed % 3
  const isHealthy = copilot.status === 'active'
  
  return (
    <div className="relative flex h-full flex-col p-5">

        {/* Holographic background (always visible, not just hover) but constrained to top area */}
      <div className="absolute left-0 top-0 h-[100px] w-full overflow-hidden rounded-t-2xl pointer-events-none opacity-[0.10] dark:opacity-[0.03]">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#80808012_1px,transparent_1px),linear-gradient(to_bottom,#80808012_1px,transparent_1px)] bg-[size:12px_12px] [mask-image:linear-gradient(to_bottom,black_0%,transparent_100%)]" />
        <div className={clsx(
          "absolute -top-12 right-0 size-40 blur-3xl rounded-full mix-blend-plus-lighter",
          variant === 0 ? "bg-accent-500/20" : variant === 1 ? "bg-cyan-500/20" : "bg-fuchsia-500/20"
        )} />
      </div>

      {/* Main Identity Deck */}
      <div className="relative z-10 flex grow flex-col">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="relative group/avatar">
              <div className={clsx(
                "absolute -inset-1 rounded-[14px] opacity-0 group-hover/avatar:opacity-100 transition-opacity duration-700",
                isHealthy ? "bg-accent-500/20 dark:bg-accent-400/20" : "bg-zinc-500/20"
              )} />
              <div className="absolute -inset-1 rounded-[14px] bg-white dark:bg-zinc-950 m-px" />
              <CopilotAvatar copilot={copilot} className="relative z-10 size-11 shrink-0 rounded-xl ring-1 ring-zinc-900/10 dark:ring-white/10 transition-transform duration-500 group-hover/avatar:scale-105" />
            </div>
            <div>
              <Link href={href} title={copilot.name} className="truncate text-base font-semibold tracking-tight text-zinc-900 before:absolute before:inset-0 dark:text-white">
                {copilot.name}
              </Link>
              <div className="mt-1 flex items-center gap-1.5">
                <div 
                  title={COPILOT_STATUS_LABELS[copilot.status]} 
                  className={STATUS_ICON_CLASS[copilot.status]}
                >
                  {(() => {
                    const StatusIcon = STATUS_ICONS[copilot.status]
                    return <StatusIcon className="size-3.5" />
                  })()}
                </div>
                <span className="font-mono text-[10px] text-zinc-500">{copilot.slug}</span>
              </div>
            </div>
          </div>
          
          <div className="relative z-20 shrink-0">
            <Dropdown>
              <DropdownButton plain aria-label={`Actions for ${copilot.name}`}>
                <EllipsisVerticalIcon className="size-5" />
              </DropdownButton>
              <DropdownMenu anchor="bottom end">
                <DropdownItem href={`${href}/improve`}>Improve</DropdownItem>
                {children}
              </DropdownMenu>
            </Dropdown>
          </div>
        </div>

        {/* Project Target */}
        <div className="mt-6 flex items-center gap-2">
          <div className={clsx(
            "flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[10px] font-medium tracking-wide border",
            contextMuted 
              ? "border-transparent bg-zinc-100 text-zinc-500 dark:bg-zinc-800/50 dark:text-zinc-400" 
              : "border-accent-500/10 bg-accent-500/5 text-accent-700 dark:border-accent-400/10 dark:bg-accent-400/5 dark:text-accent-400"
          )}>
            <FolderIcon className="size-3" />
            <span className="truncate">{contextLabel}</span>
          </div>
        </div>
      </div>

      {/* Telemetry Strip (Inset box instead of full bleed footer) */}
      <div className="relative z-10 mt-auto grid grid-cols-3 gap-2 rounded-xl bg-zinc-50 p-3 ring-1 ring-inset ring-zinc-950/5 dark:bg-zinc-900/40 dark:ring-white/5">
        <div className="flex flex-col gap-0.5">
          <span className="text-[9px] font-medium uppercase tracking-widest text-zinc-400">Tests</span>
          <span className={clsx("font-mono text-xs", tested ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400")}>
            {tested ? formatPercent(copilot.health.testPassRate) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-l border-zinc-950/10 pl-3 dark:border-white/10">
          <span className="text-[9px] font-medium uppercase tracking-widest text-zinc-400">Bench</span>
          <span className={clsx("font-mono text-xs", benched ? "text-accent-600 dark:text-accent-400" : "text-zinc-400")}>
            {benched ? copilot.health.benchmarkScore.toFixed(1) : '—'}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 border-l border-zinc-950/10 pl-3 dark:border-white/10">
          <span className="text-[9px] font-medium uppercase tracking-widest text-zinc-400">Runs</span>
          <span className={clsx("font-mono text-xs", runs > 0 ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-400")}>
            {runs > 0 ? runs : '0'}
          </span>
        </div>
        
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-accent-500 opacity-0 transition-all duration-300 group-hover:translate-x-1 group-hover:opacity-100">
          <ArrowRightIcon className="size-4" />
        </div>
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

  // Group by project for "All" view to show them by category
  const activeByProject = useMemo(() => {
    const groups = new Map<string | null, Copilot[]>()
    for (const copilot of activeRows) {
      const pid = copilot.projectId
      if (!groups.has(pid)) groups.set(pid, [])
      groups.get(pid)!.push(copilot)
    }
    return groups
  }, [activeRows])

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
          <div className="space-y-12">
            {view === 'bench' ? (
              <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {activeRows.map(renderCard)}
              </ul>
            ) : (
              <div className="space-y-10">
                {Array.from(activeByProject.entries())
                  .sort(([a], [b]) => {
                    if (a === null) return 1 // Bench at the bottom
                    if (b === null) return -1
                    const nameA = projectNameById.get(a) || ''
                    const nameB = projectNameById.get(b) || ''
                    return nameA.localeCompare(nameB)
                  })
                  .map(([projectId, projectCopilots]) => {
                    const categoryName = projectId === null ? 'Validation bench' : (projectNameById.get(projectId) || projectId)
                    return (
                      <div key={projectId ?? 'bench'} className="space-y-4">
                        <div className="flex items-center gap-4">
                          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-white">
                            {categoryName}
                          </h3>
                          <div className="h-px flex-1 bg-zinc-950/5 dark:bg-white/5" />
                        </div>
                        <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                          {projectCopilots.map(renderCard)}
                        </ul>
                      </div>
                    )
                  })}
              </div>
            )}

            {pausedRows.length > 0 ? (
              <div className="pt-4">
                <div className="flex items-center gap-4 mb-4">
                  <h3 className="text-sm font-semibold tracking-tight text-zinc-500">Paused Copilots</h3>
                  <div className="h-px flex-1 bg-zinc-950/5 dark:bg-white/5" />
                </div>
                <ul role="list" className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
