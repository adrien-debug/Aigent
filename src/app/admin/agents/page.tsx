import clsx from 'clsx'
import type { Metadata } from 'next'

import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
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

/**
 * Status dot. The design system is mono-accent, so `degraded` and `unavailable`
 * cannot be told apart from `inactive` by hue — they are separated by DENSITY
 * instead (filled accent / ringed / hollow), and the label always carries the
 * meaning in words. Colour is never the only channel.
 */
const STATUS_DOT: Record<string, string> = {
  active: 'bg-accent-500',
  inactive: 'bg-zinc-600',
  degraded: 'bg-zinc-500 ring-2 ring-zinc-500/30',
  unavailable: 'bg-transparent ring-1 ring-zinc-600',
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
                  {/* Eight fixed-width columns sum to ~816px, far past a 390px
                      viewport: in a `table-fixed` layout with no scrollport they
                      did not shrink, they COLLIDED — headers overlapping and the
                      agent name column squeezed to nothing. Columns now drop by
                      priority instead, so what remains always fits. */}
                  <TableHeader className="pl-4!">Agent</TableHeader>
                  <TableHeader className="hidden w-36 lg:table-cell">Project</TableHeader>
                  {/* w-32, not w-24: the widest status label is UNAVAILABLE, and in a
                      table-fixed layout a too-narrow column lets the badge bleed into
                      the next cell instead of widening its own. */}
                  {/* Sized for "UNAVAILABLE" + its status dot at NORMAL tracking.
                      The widest tracking needed w-40, which then stole width from
                      the agent name — the column that identifies the row. */}
                  <TableHeader className="w-[7.5rem] sm:w-[8.5rem]">Status</TableHeader>
                  {/* Provider and model answer ONE question — "what runs this
                      agent" — but sat in two columns with different breakpoints,
                      so between lg and xl the model showed with no provider to
                      qualify it. Merged into a single Runtime column that appears
                      in one go, which also buys back the width the avatar needs. */}
                  <TableHeader className="hidden w-44 lg:table-cell">Runtime</TableHeader>
                  <TableHeader className="hidden w-20 text-right xl:table-cell">Tools</TableHeader>
                  <TableHeader className="hidden w-28 text-right sm:table-cell">Last run</TableHeader>
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
                      className="group h-14"
                    >
                      {/* py-2! pins the row to the h-14 set above, matching the
                          projects table on the cockpit so the two read as one
                          rhythm instead of two densities. It must beat the
                          primitive's own py-*, which class order alone would not do. */}
                      <TableCell className="py-2! pl-4!">
                        <div className="flex min-w-0 items-center gap-3">
                          {/* Reuses the existing CopilotAvatar: the glyph is derived
                              from slug/name/capabilities and is decorative only —
                              never a claim about the agent (there is no type field). */}
                          <CopilotAvatar
                            copilot={{ slug: agent.copilotId, name: agent.name, tags: agent.capabilities }}
                            className="size-8"
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-zinc-900 group-hover:underline dark:text-white">
                              {agent.name}
                            </div>
                            {/* Below lg the Project and Runtime columns are dropped, so
                                their values fold under the name rather than being lost. */}
                            <div className="truncate font-mono text-xs text-zinc-500">
                              <span className="lg:hidden">{projectName !== '—' ? `${projectName} · ` : ''}</span>
                              {agent.version ?? '—'}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden py-2! truncate text-sm text-zinc-600 lg:table-cell dark:text-zinc-400">
                        {projectName}
                      </TableCell>
                      <TableCell className="py-2!">
                        {/* Normal tracking at every size: "UNAVAILABLE" at the
                            widest letter-spacing is the single widest cell in the
                            table and was stealing width from the agent name. */}
                        <Badge color={badgeColor} className="gap-1.5 uppercase tracking-normal">
                          <span
                            aria-hidden="true"
                            className={clsx('size-1.5 shrink-0 rounded-full', STATUS_DOT[agent.status])}
                          />
                          {agent.status}
                        </Badge>
                      </TableCell>
                      {/* Runtime — model on top (the identifying fact), provider as
                          its qualifier underneath. Two lines here rather than two
                          columns, so the pair never splits across breakpoints. */}
                      <TableCell className="hidden py-2! lg:table-cell">
                        <div className="truncate font-mono text-sm text-zinc-600 dark:text-zinc-400">
                          {agent.configuredModel ?? <NotMeasuredDash />}
                        </div>
                        <div className="truncate font-mono text-xs text-zinc-500">{agent.provider ?? '—'}</div>
                      </TableCell>
                      <TableCell className="hidden py-2! text-right font-mono text-sm tabular-nums text-zinc-600 xl:table-cell dark:text-zinc-400">
                        {agent.tools.length}
                      </TableCell>
                      <TableCell className="hidden py-2! text-right font-mono text-xs tabular-nums text-zinc-500 sm:table-cell">
                        {agent.lastRunAt ? formatRelativeCompact(agent.lastRunAt, now) : <NotMeasuredDash />}
                      </TableCell>
                      <TableCell className="py-2! pr-4! text-right font-mono text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                        {agent.lastRunCostUsd !== null ? formatUsd(agent.lastRunCostUsd) : <NotMeasuredDash />}
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
