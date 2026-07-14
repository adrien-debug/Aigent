'use client'

import clsx from 'clsx'
import { useMemo } from 'react'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatPercent, formatUsd } from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS, COPILOT_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { Copilot, CopilotStatus, Project } from '@/lib/agent-mission-control/types'

export type RegistryTableView = 'bench' | 'all'

function statusColor(status: CopilotStatus) {
  switch (status) {
    case 'active': return 'text-zinc-300'
    case 'degraded': return 'text-accent-400'
    case 'draft': return 'text-zinc-500'
    default: return 'text-zinc-600'
  }
}

function ListRow({ copilot, project }: { copilot: Copilot, project?: Project }) {
  return (
    <TableRow className="group transition-colors hover:bg-[var(--color-surface-interactive)]">
      <TableCell className="py-4 px-6">
        <div className="flex items-center gap-4">
          <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
          <div className="flex flex-col min-w-0">
            <Link href={`/admin/agents/${copilot.id}`} className="text-[13px] text-zinc-200 truncate group-hover:text-white transition-colors before:absolute before:inset-0">
              {copilot.name}
            </Link>
            <span className="text-[10px] text-zinc-600 font-mono truncate">{copilot.slug}</span>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-4 px-6">
        <span className={clsx('text-[11px]', statusColor(copilot.status))}>
          {COPILOT_STATUS_LABELS[copilot.status]}
        </span>
      </TableCell>

      <TableCell className="py-4 px-6">
        {project ? (
          <span className="text-[13px] text-zinc-400 truncate">{project.name}</span>
        ) : (
          <span className="text-[13px] text-zinc-600">—</span>
        )}
      </TableCell>

      <TableCell className="py-4 px-6 text-right">
        <span className="text-[13px] font-mono text-zinc-300">{copilot.health.runsLast24h.toLocaleString()}</span>
      </TableCell>

      <TableCell className="py-4 px-6 text-right">
        <span className="text-[13px] font-mono text-zinc-400">{formatUsd(copilot.health.costLast24hUsd)}</span>
      </TableCell>

      <TableCell className="py-4 px-6 text-right">
        <span className={clsx("text-[13px] font-mono", copilot.health.testPassRate >= 0.9 ? 'text-zinc-300' : 'text-accent-400')}>
          {formatPercent(copilot.health.testPassRate)}
        </span>
      </TableCell>

      <TableCell className="py-4 px-6 text-right">
        <span className="text-[11px] text-zinc-500 group-hover:text-white transition-colors">Open &rarr;</span>
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
    return result.sort((a, b) => {
      if (a.status === 'active' && b.status !== 'active') return -1
      if (b.status === 'active' && a.status !== 'active') return 1
      return b.health.runsLast24h - a.health.runsLast24h
    })
  }, [copilots, view, searchQuery])

  const projectMap = useMemo(() => new Map(projects.map(p => [p.id, p])), [projects])

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-[13px] text-zinc-500">No copilots found.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl bg-[var(--color-surface-secondary)] border border-white/5 overflow-hidden">
      <div className="overflow-x-auto no-scrollbar">
        <Table className="w-full text-left border-collapse min-w-[1000px]">
          <TableHead>
            <TableRow className="border-b border-white/5 bg-black/40">
              <TableHeader>Copilot</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Project</TableHeader>
              <TableHeader className="text-right">Volume</TableHeader>
              <TableHeader className="text-right">Cost</TableHeader>
              <TableHeader className="text-right">Quality</TableHeader>
              <TableHeader></TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {filtered.map(copilot => (
              <ListRow 
                key={copilot.id} 
                copilot={copilot} 
                project={copilot.projectId ? projectMap.get(copilot.projectId) : undefined} 
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
