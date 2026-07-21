import type { Metadata } from 'next'

import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { EmptyState } from '@/components/agent-ops/empty-state'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { Badge } from '@/components/catalyst/badge'
import { surfaceRaised } from '@/components/catalyst/surface'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getAvailableAgents } from '@/lib/agent-mission-control/available-agents'
import { getProjects } from '@/lib/agent-mission-control/data'
import { formatRelativeCompact, formatUsd } from '@/lib/agent-mission-control/format'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agents — Aigent',
}

const STATUS_BADGE: Record<string, 'accent' | 'zinc'> = {
  active: 'accent',
  inactive: 'zinc',
  degraded: 'zinc',
  unavailable: 'zinc',
}

export default async function AgentsPage() {
  const [agents, projects] = await Promise.all([getAvailableAgents(), getProjects()])
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))
  const now = new Date().toISOString()

  return (
    <div className="flex flex-col gap-4 pb-8">
      <AdminPageHeader
        eyebrow="Agents"
        title="All Agents"
        description="Every provisioned copilot from the canonical runtime catalogue, with its real execution truth."
        className="pb-0"
      />

      <div className={`${surfaceRaised} overflow-hidden`}>
        {agents.length > 0 ? (
          <div className="min-h-0">
            <Table fixed className="w-full text-left [--gutter:--spacing(0)]">
              <TableHead>
                <TableRow>
                  <TableHeader className="pl-4!">Agent</TableHeader>
                  <TableHeader className="w-36">Project</TableHeader>
                  {/* w-32, not w-24: the widest status label is UNAVAILABLE, and in a
                      table-fixed layout a too-narrow column lets the badge bleed into
                      the next cell instead of widening its own. */}
                  <TableHeader className="w-32">Status</TableHeader>
                  <TableHeader className="w-24">Provider</TableHeader>
                  <TableHeader className="w-40">Model</TableHeader>
                  <TableHeader className="w-20 text-right">Tools</TableHeader>
                  <TableHeader className="w-28 text-right">Last run</TableHeader>
                  <TableHeader className="w-24 pr-4! text-right">Cost</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {agents.map((agent) => {
                  const projectName = agent.projectId ? projectNameById.get(agent.projectId) ?? '—' : '—'
                  const badgeColor = STATUS_BADGE[agent.status] ?? 'zinc'
                  return (
                    <TableRow
                      key={agent.copilotId}
                      href={`/admin/agents/${agent.copilotId}`}
                      title={`Open agent ${agent.name}`}
                      className="group"
                    >
                      <TableCell className="py-3! pl-4!">
                        <div className="truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-white">
                          {agent.name}
                        </div>
                        <div className="truncate font-mono text-xs text-zinc-500">{agent.version ?? '—'}</div>
                      </TableCell>
                      <TableCell className="py-3! truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {projectName}
                      </TableCell>
                      <TableCell className="py-3!">
                        <Badge color={badgeColor} className="uppercase tracking-widest">
                          {agent.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="py-3! font-mono text-sm text-zinc-600 dark:text-zinc-400">
                        {agent.provider ?? '—'}
                      </TableCell>
                      <TableCell className="py-3! truncate font-mono text-sm text-zinc-600 dark:text-zinc-400">
                        {agent.configuredModel ?? '—'}
                      </TableCell>
                      <TableCell className="py-3! text-right font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {agent.tools.length}
                      </TableCell>
                      <TableCell className="py-3! text-right font-mono text-xs tabular-nums text-zinc-500">
                        {agent.lastRunAt ? formatRelativeCompact(agent.lastRunAt, now) : '—'}
                      </TableCell>
                      <TableCell className="py-3! pr-4! text-right font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {agent.lastRunCostUsd !== null ? formatUsd(agent.lastRunCostUsd) : '—'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <EmptyState
            title="No agents yet"
            description="Provision the first copilot to see it in the runtime catalogue."
            className="py-12"
            action={<SoftAccentLink href="/admin/agents/new">New copilot</SoftAccentLink>}
          />
        )}
      </div>
    </div>
  )
}
