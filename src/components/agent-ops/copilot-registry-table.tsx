'use client'

import clsx from 'clsx'
import { useMemo } from 'react'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { Badge } from '@/components/catalyst/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { COPILOT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { Copilot, DisplayStatus, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

/**
 * Status → Catalyst badge intensity on the mono-accent ladder.
 * `active` is the healthy default (neutral zinc); anything needing attention
 * escalates on the accent ramp. The label always carries the meaning.
 */
function statusBadgeColor(status: DisplayStatus): 'zinc' | 'accent' | 'accentStrong' {
  switch (status) {
    case 'production':
      return 'accent'
    case 'active':
      return 'zinc'
    case 'degraded':
      return 'accentStrong'
    case 'paused':
      return 'accent'
    default:
      // draft, archived — quiet neutral
      return 'zinc'
  }
}

/** Human label including the derived `production` state (data.ts). */
function statusLabel(status: DisplayStatus): string {
  return status === 'production' ? 'Production' : COPILOT_STATUS_LABELS[status]
}

function ListRow({ copilot, project }: { copilot: Copilot; project?: Project }) {
  return (
    <TableRow href={`/admin/agents/${copilot.id}`} title={copilot.name} className="group">
      {/* Copilot — takes the flexible space, truncates */}
      <TableCell className="py-4">
        <div className="flex items-center gap-3">
          <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[13px] text-zinc-200 transition-colors group-hover:text-white">
              {copilot.name}
            </span>
            <span className="truncate font-mono text-[10px] text-zinc-600">{copilot.slug}</span>
          </div>
        </div>
      </TableCell>

      {/* Status — real Catalyst badge, never clips. Derived displayStatus so a
          copilot serving production reads "Production", not the stale "Draft". */}
      <TableCell className="py-4">
        <Badge color={statusBadgeColor(copilot.displayStatus ?? copilot.status)} className="whitespace-nowrap">
          {statusLabel(copilot.displayStatus ?? copilot.status)}
        </Badge>
      </TableCell>

      {/* Project — hidden on mobile (carried by detail), truncates */}
      <TableCell className="hidden py-4 sm:table-cell">
        {project ? (
          <span className="block max-w-[16ch] truncate text-[13px] text-zinc-400 lg:max-w-[22ch]">
            {project.name}
          </span>
        ) : (
          <span className="text-[13px] text-zinc-600">—</span>
        )}
      </TableCell>

      {/* Volume — lg+ only */}
      <TableCell className="hidden py-4 text-right lg:table-cell">
        <span className="font-mono text-[13px] text-zinc-300">
          {copilot.health.runsLast24h.toLocaleString()}
        </span>
      </TableCell>

      {/* Cost — xl+ only */}
      <TableCell className="hidden py-4 text-right xl:table-cell">
        <span className="font-mono text-[13px] text-zinc-400">{formatUsd(copilot.health.costLast24hUsd)}</span>
      </TableCell>

      {/* Quality — always visible, right edge. A dash (not a false 0.0%) when no
          run has measured this copilot yet; a real, run-backed % otherwise. */}
      <TableCell className="py-4 text-right">
        {copilot.healthEvidence === 'runs' ? (
          <span
            className={clsx(
              'font-mono text-[13px]',
              copilot.health.testPassRate >= 0.9 ? 'text-zinc-300' : 'text-accent-400'
            )}
          >
            {formatPercent(copilot.health.testPassRate)}
          </span>
        ) : (
          <span className="font-mono text-[13px] text-zinc-600">—</span>
        )}
      </TableCell>
    </TableRow>
  )
}

export function CopilotRegistryTable({
  copilots,
  projects,
  view,
  searchQuery,
}: {
  copilots: Copilot[]
  projects: Project[]
  view: RegistryTableView
  searchQuery?: string
}) {
  const filtered = useMemo(() => {
    let result = copilots
    if (view === 'bench') {
      result = result.filter((c) => c.projectId === null)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (c) => c.name.toLowerCase().includes(q) || c.slug.toLowerCase().includes(q)
      )
    }
    return [...result].sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (b.status === 'active' && a.status !== 'active') return 1
      return b.health.runsLast24h - a.health.runsLast24h
    })
  }, [copilots, view, searchQuery])

  const projectMap = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects])

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-6 py-24 text-center">
        <p className="text-[13px] text-zinc-400">
          {searchQuery ? 'No copilots match your search.' : 'No copilots yet.'}
        </p>
        <p className="text-xs text-zinc-600">
          {searchQuery
            ? 'Try a different name or slug.'
            : view === 'bench'
              ? 'Every copilot is assigned to a project.'
              : 'Provision a copilot to see it here.'}
        </p>
      </div>
    )
  }

  return (
    <div className="px-6 py-2">
      <Table
        className="[--gutter:--spacing(0)]"
        aria-label={view === 'bench' ? 'Copilots on the validation bench' : 'All copilots'}
      >
        <TableHead>
          <TableRow>
            <TableHeader>Copilot</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader className="hidden sm:table-cell">Project</TableHeader>
            <TableHeader className="hidden text-right lg:table-cell">Volume</TableHeader>
            <TableHeader className="hidden text-right xl:table-cell">Cost</TableHeader>
            <TableHeader className="text-right">Quality</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {filtered.map((copilot) => (
            <ListRow
              key={copilot.id}
              copilot={copilot}
              project={copilot.projectId ? projectMap.get(copilot.projectId) : undefined}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
