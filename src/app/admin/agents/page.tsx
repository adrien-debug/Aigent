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
import {
  AGENT_STATUS_DIMENSION_LABELS,
  AVAILABLE_AGENT_STATUS_LABELS,
  agentExecutableLabel,
  copilotStatusLabel,
  runtimeLabel,
} from '@/lib/agent-mission-control/labels'

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
                  {/* An agent carries THREE statuses at once and this column shows
                      one of them, so the header names WHICH: the badge is runtime
                      availability, the line under it is the stored lifecycle. A
                      bare "Status" header is what let the same agent read ACTIVE
                      here and IDLE on the team canvas with neither one wrong. */}
                  <TableHeader className="w-[7.5rem] sm:w-[8.5rem]">
                    {AGENT_STATUS_DIMENSION_LABELS.runtime} status
                  </TableHeader>
                  {/* Runtime = the wired execution path (`copilots.runtime`). This
                      column used to show the model and the provider under a
                      "Runtime" header — two real facts, neither of them the
                      runtime. Both now sit here, each under its own name. */}
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
                      // The third status dimension. There is no room for a third
                      // line in a row that must stay 56px, so executability rides
                      // the row tooltip — qualified, never a bare word.
                      title={`Open agent ${agent.name} — ${AGENT_STATUS_DIMENSION_LABELS.executable}: ${agentExecutableLabel(agent.executable)}`}
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
                          {AVAILABLE_AGENT_STATUS_LABELS[agent.status]}
                        </Badge>
                        {/* The operator's decision, next to what the runtime can
                            prove. "Inactive (runtime) / Draft (lifecycle)" is one
                            agent honestly described, not two contradictory ones. */}
                        <div className="mt-1 truncate text-[11px] text-zinc-500">
                          {AGENT_STATUS_DIMENSION_LABELS.lifecycle}:{' '}
                          {copilotStatusLabel(agent.lifecycleStatus)}
                        </div>
                      </TableCell>
                      {/* Runtime on top — the execution path that decides whether
                          anything can run at all — then the model and its provider
                          as the qualifier. Two lines here rather than two columns,
                          so the pair never splits across breakpoints. */}
                      <TableCell className="hidden py-2! lg:table-cell">
                        <div className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                          {runtimeLabel(agent.runtime) ?? <NotMeasuredDash />}
                        </div>
                        <div className="truncate font-mono text-xs text-zinc-500">
                          {agent.configuredModel ?? '—'}
                          {agent.provider ? ` · ${agent.provider}` : ''}
                        </div>
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
