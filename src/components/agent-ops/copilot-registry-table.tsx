'use client'

import { MagnifyingGlassIcon } from '@heroicons/react/16/solid'
import { useMemo, useState } from 'react'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Avatar } from '@/components/catalyst/avatar'
import { Button } from '@/components/catalyst/button'
import { Field, Label } from '@/components/catalyst/fieldset'
import { Input, InputGroup } from '@/components/catalyst/input'
import { Link } from '@/components/catalyst/link'
import { Select } from '@/components/catalyst/select'
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

/** Two-letter initials from a copilot name, for the generated avatar. */
function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/**
 * One copilot row — the Tailwind Plus "users" table pattern mapped onto copilot
 * data: generated avatar + name/slug, runtime/model, status pill, owner, and an
 * Open link.
 */
function CopilotRow({ copilot }: { copilot: Copilot }) {
  const href = `/admin/agents/${copilot.id}`
  return (
    <tr className="transition-colors duration-150 hover:bg-white/2.5">
      <td className="py-5 pr-3 pl-4 text-sm whitespace-nowrap sm:pl-0">
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
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap text-zinc-400">
        <div className="text-white">{AGENT_RUNTIME_LABELS[copilot.runtime]}</div>
        <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">{copilot.model}</div>
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap">
        <StatusBadge status={copilot.status} />
      </td>
      <td className="px-3 py-5 text-sm whitespace-nowrap text-zinc-400">{copilot.owner}</td>
      <td className="py-5 pr-4 pl-3 text-right text-sm font-medium whitespace-nowrap sm:pr-0">
        <Link href={href} className="text-green-400 hover:text-green-300">
          Open<span className="sr-only">, {copilot.name}</span>
        </Link>
      </td>
    </tr>
  )
}

/**
 * Filterable copilot registry table on the Tailwind Plus users layout: avatar +
 * name/slug, runtime/model, status pill, owner, Open link. Paused copilots are
 * pulled out of the main list into a separate section at the bottom.
 */
export function CopilotRegistryTable({
  copilots,
  projects,
}: {
  copilots: Copilot[]
  projects: Project[]
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

  // Pull paused copilots out of the main list into a separate section.
  const activeRows = filtered.filter((copilot) => copilot.status !== 'paused')
  const pausedRows = filtered.filter((copilot) => copilot.status === 'paused')

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
                      <th scope="col" className="px-3 py-3.5 text-left text-sm font-semibold text-white">
                        Owner
                      </th>
                      <th scope="col" className="py-3.5 pr-4 pl-3 sm:pr-0">
                        <span className="sr-only">Open</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {activeRows.map((copilot) => (
                      <CopilotRow key={copilot.id} copilot={copilot} />
                    ))}
                  </tbody>

                  {pausedRows.length > 0 ? (
                    <tbody className="divide-y divide-white/10 border-t border-white/15">
                      <tr>
                        <th
                          scope="colgroup"
                          colSpan={5}
                          className="py-2 pr-3 pl-4 text-left text-xs font-medium tracking-wide text-zinc-500 uppercase sm:pl-0"
                        >
                          Paused
                        </th>
                      </tr>
                      {pausedRows.map((copilot) => (
                        <CopilotRow key={copilot.id} copilot={copilot} />
                      ))}
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
