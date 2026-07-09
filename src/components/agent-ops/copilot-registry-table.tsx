'use client'

import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import clsx from 'clsx'
import { useMemo, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { passRateClassName } from '@/components/agent-ops/health-format'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS } from '@/lib/agent-mission-control/mock-data'
import type { AgentRuntime, Copilot, CopilotStatus, Project } from '@/lib/agent-mission-control/types'

const STATUS_LABELS: Record<CopilotStatus, string> = {
  active: 'Active',
  degraded: 'Degraded',
  paused: 'Paused',
  draft: 'Draft',
  archived: 'Archived',
}

const RUNTIME_OPTIONS = Object.keys(AGENT_RUNTIME_LABELS) as AgentRuntime[]
const STATUS_OPTIONS = Object.keys(STATUS_LABELS) as CopilotStatus[]

/** No test signal yet: draft/archived copilots, or zero pass rate with zero runs. */
function isUntested(copilot: Copilot): boolean {
  return (
    copilot.health.testPassRate === 0 &&
    (copilot.status === 'draft' || copilot.status === 'archived' || copilot.health.runsLast24h === 0)
  )
}

/**
 * Filterable copilot registry table. Each row carries a keyboard-focusable
 * "Preview" button (sr-only label, cell-overlay — same pattern as the Catalyst
 * row link) that selects the copilot for the preview panel; clicking anywhere
 * on the row also selects it, and the name deep-links to the copilot overview.
 */
export function CopilotRegistryTable({
  copilots,
  projects,
  selectedId,
  onSelect,
}: {
  copilots: Copilot[]
  projects: Project[]
  selectedId?: string | null
  onSelect?: (copilot: Copilot) => void
}) {
  const [query, setQuery] = useState('')
  const [projectId, setProjectId] = useState<string>('all')
  const [runtime, setRuntime] = useState<AgentRuntime | 'all'>('all')
  const [status, setStatus] = useState<CopilotStatus | 'all'>('all')

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return copilots.filter((copilot) => {
      if (projectId !== 'all' && copilot.projectId !== projectId) return false
      if (runtime !== 'all' && copilot.runtime !== runtime) return false
      if (status !== 'all' && copilot.status !== status) return false
      if (needle.length > 0) {
        const haystack = `${copilot.name} ${copilot.slug} ${copilot.owner} ${copilot.model}`.toLowerCase()
        if (!haystack.includes(needle)) return false
      }
      return true
    })
  }, [copilots, query, projectId, runtime, status])

  function resetFilters() {
    setQuery('')
    setProjectId('all')
    setRuntime('all')
    setStatus('all')
  }

  return (
    <AgentSectionCard
      title="Copilot registry"
      description="Every copilot across projects — filter by project, runtime or status."
      actions={
        <span className="text-xs text-zinc-500 tabular-nums">
          {filtered.length} of {copilots.length}
        </span>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          <Table bleed dense className="[--gutter:--spacing(6)]">
            <TableHead>
              <TableRow>
                <TableHeader>Name</TableHeader>
                <TableHeader>Runtime</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader className="text-right" title="Test pass rate">
                  Tests<span className="sr-only"> pass rate</span>
                </TableHeader>
                <TableHeader className="text-right" title="Runs last 24h">
                  Runs<span className="sr-only"> last 24h</span>
                </TableHeader>
                <TableHeader className="text-right" title="Cost last 24h">
                  Cost<span className="sr-only"> last 24h</span>
                </TableHeader>
                <TableHeader className="text-right" title="Open warnings">
                  Warn.<span className="sr-only"> Open warnings</span>
                </TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {filtered.map((copilot) => {
                const isSelected = copilot.id === selectedId
                const untested = isUntested(copilot)
                const noRuns = copilot.health.runsLast24h === 0
                return (
                  <TableRow
                    key={copilot.id}
                    onClick={() => onSelect?.(copilot)}
                    className={clsx(
                      'cursor-pointer transition-colors duration-150',
                      'hover:bg-zinc-950/2.5 dark:hover:bg-white/2.5',
                      'has-[[data-row-select]:focus-visible]:outline-2 has-[[data-row-select]:focus-visible]:-outline-offset-2 has-[[data-row-select]:focus-visible]:outline-blue-500',
                      isSelected && 'bg-zinc-950/2.5 dark:bg-white/2.5'
                    )}
                  >
                    <TableCell>
                      <button
                        type="button"
                        data-row-select
                        aria-pressed={isSelected}
                        onClick={(event) => {
                          event.stopPropagation()
                          onSelect?.(copilot)
                        }}
                        className="absolute inset-0 cursor-pointer focus:outline-hidden"
                      >
                        <span className="sr-only">Preview {copilot.name}</span>
                      </button>
                      <Link
                        href={`/admin/agents/${copilot.id}`}
                        onClick={(event) => event.stopPropagation()}
                        title={copilot.name}
                        className="relative block max-w-44 truncate font-medium text-zinc-950 hover:underline dark:text-white"
                      >
                        {copilot.name}
                      </Link>
                      <span className="block max-w-44 truncate font-mono text-xs text-zinc-500">{copilot.slug}</span>
                    </TableCell>
                    <TableCell>
                      <RuntimeBadge runtime={copilot.runtime} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={copilot.status} />
                    </TableCell>
                    <TableCell
                      className={clsx(
                        'text-right font-mono tabular-nums',
                        untested ? 'text-zinc-500' : passRateClassName(copilot.health.testPassRate)
                      )}
                    >
                      {untested ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">not tested</span>
                        </>
                      ) : (
                        formatPercent(copilot.health.testPassRate)
                      )}
                    </TableCell>
                    <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                      {copilot.health.runsLast24h}
                    </TableCell>
                    <TableCell
                      className={clsx(
                        'text-right font-mono tabular-nums',
                        noRuns ? 'text-zinc-500' : 'text-zinc-700 dark:text-zinc-300'
                      )}
                    >
                      {noRuns ? (
                        <>
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">no runs</span>
                        </>
                      ) : (
                        formatUsd(copilot.health.costLast24hUsd)
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-x-1.5 tabular-nums">
                        {copilot.health.openWarnings > 0 ? (
                          <span
                            aria-hidden="true"
                            className="size-1.5 shrink-0 rounded-full bg-amber-500 dark:bg-amber-400"
                          />
                        ) : null}
                        <span
                          className={
                            copilot.health.openWarnings > 0
                              ? 'text-amber-600 dark:text-amber-400'
                              : 'text-zinc-500'
                          }
                        >
                          {copilot.health.openWarnings}
                        </span>
                        <span className="sr-only">open warnings</span>
                      </span>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        ) : (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <span className="flex size-10 items-center justify-center rounded-lg bg-zinc-950/5 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:ring-white/10">
              <MagnifyingGlassIcon aria-hidden="true" className="size-5 text-zinc-500 dark:text-zinc-400" />
            </span>
            <p className="mt-4 text-sm font-semibold text-zinc-950 dark:text-white">No copilots match</p>
            <p className="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Adjust the search or clear the filters to find the copilot you&apos;re looking for.
            </p>
            <Button outline className="mt-6" onClick={resetFilters}>
              Reset filters
            </Button>
          </div>
        )}
      </div>
    </AgentSectionCard>
  )
}
