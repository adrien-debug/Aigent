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
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { formatPercent, formatRelativeCompact, formatUsd } from '@/lib/agent-mission-control/format'
import {
  AGENT_RUN_STATUS_LABELS,
  AGENT_STATUS_DIMENSION_LABELS,
  agentExecutableLabel,
  copilotStatusLabel,
  runtimeLabel,
} from '@/lib/agent-mission-control/labels'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Agents — Aigent',
}

/**
 * STATE = the lifecycle the operator chose (`copilots.status`, via
 * `copilotStatusLabel`), not the runtime-derived `AvailableAgent.status`. The
 * design system is mono-accent, so `degraded`/`archived`/`paused` cannot be
 * told apart from `draft` by hue — they are separated by DENSITY instead
 * (filled accent / ringed / hollow), and the label always carries the
 * meaning in words. Colour is never the only channel.
 */
const STATE_BADGE: Record<string, 'accent' | 'accentStrong' | 'accentSolid' | 'zinc'> = {
  active: 'accent',
  degraded: 'accentStrong',
  paused: 'zinc',
  draft: 'zinc',
  archived: 'accentSolid',
}

const STATE_DOT: Record<string, string> = {
  active: 'bg-accent-500',
  degraded: 'bg-zinc-500 ring-2 ring-zinc-500/30',
  paused: 'bg-zinc-600',
  draft: 'bg-transparent ring-1 ring-zinc-600',
  archived: 'bg-transparent ring-1 ring-zinc-600',
}

export default async function AgentsPage() {
  const [agents, projects, copilots] = await Promise.all([
    getAvailableAgents(),
    getProjects(),
    // `list` depth: this page shows testPassRate + costLast24hUsd only, not
    // benchmark/latency — same batched call the dashboard project rollup uses,
    // loaded ONCE here and joined by id, never per-row.
    getCopilots({ health: 'list' }),
  ])
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))
  const healthByCopilotId = new Map(copilots.map((c) => [c.id, c]))
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
                  {/* Target column order: Agent · State · Executable · Last run ·
                      Success · Cost 24h · Action. Secondary facts (project,
                      runtime, model, served version) are folded into the Agent
                      cell or responsive-hidden columns rather than heading the
                      table. Below their breakpoint columns drop by priority so
                      what remains always fits — no horizontal page scroll. */}
                  <TableHeader className="pl-4!">Agent</TableHeader>
                  {/* STATE — the operator's lifecycle decision. Distinct from
                      Executable: an agent can be `active` (state) and still not
                      executable (an unresolved tool), and the two columns must
                      never be collapsed into one or that contradiction becomes
                      unreadable. */}
                  <TableHeader className="w-28 sm:w-32">{AGENT_STATUS_DIMENSION_LABELS.lifecycle}</TableHeader>
                  <TableHeader className="hidden w-24 sm:table-cell">
                    {AGENT_STATUS_DIMENSION_LABELS.executable}
                  </TableHeader>
                  <TableHeader className="hidden w-28 text-right md:table-cell">Last run</TableHeader>
                  <TableHeader className="hidden w-20 text-right lg:table-cell">Success</TableHeader>
                  <TableHeader className="hidden w-24 text-right lg:table-cell">
                    Cost<span className="sr-only"> over the last 24 hours</span>
                    <span aria-hidden="true" className="ml-1 font-normal text-zinc-500">24h</span>
                  </TableHeader>
                  <TableHeader className="w-28 pr-4! text-right sm:w-36">Action</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {agents.map((agent) => {
                  const projectName = agent.projectId ? projectNameById.get(agent.projectId) ?? '—' : '—'
                  const stateBadgeColor = STATE_BADGE[agent.lifecycleStatus] ?? 'zinc'
                  const stateDot = STATE_DOT[agent.lifecycleStatus] ?? 'bg-transparent ring-1 ring-zinc-600'

                  // Health is JOINED here, batched once above — never fetched per row.
                  const health = healthByCopilotId.get(agent.copilotId)
                  // `healthEvidence === 'runs'` is the same gate the dashboard project
                  // rollup uses to trust `testPassRate`: no run-backed evidence means
                  // the stored blob is a zero-init baseline, not a real 0% score.
                  const hasSuccessSignal = health?.healthEvidence === 'runs'
                  // `runsLast24h > 0` is the same gate `DashboardProjectList` uses for
                  // `costLast24hUsd`: zero runs in the window means the cost is
                  // unmeasured, never a real $0.
                  const hasCost24hSignal = health !== undefined && health.health.runsLast24h > 0

                  const lastRunLabel = agent.lastRunStatus
                    ? (AGENT_RUN_STATUS_LABELS[agent.lastRunStatus as AgentRunStatus] ?? agent.lastRunStatus)
                    : null

                  // Action: single dominant, honest affordance — never a button that
                  // isn't wired. Executable → the row's own click-through IS "Run"
                  // (agent detail hosts the real run control). Not executable → the
                  // concrete blocker, so the reason to fix it travels with the row.
                  const actionText = agent.executable
                    ? 'Run →'
                    : agent.unresolvedToolIds.length > 0
                      ? `${agent.unresolvedToolIds.length} tool${agent.unresolvedToolIds.length === 1 ? '' : 's'} unresolved`
                      : agent.lifecycleStatus === 'archived'
                        ? 'Archived'
                        : `Not ${AGENT_STATUS_DIMENSION_LABELS.executable.toLowerCase()}`

                  return (
                    <TableRow
                      key={agent.copilotId}
                      href={`/admin/agents/${agent.copilotId}`}
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
                            {/* Secondary facts demoted here: project, runtime, model,
                                served version — headline columns are State/Executable/
                                Last run/Success/Cost 24h/Action, not these. */}
                            <div className="truncate font-mono text-xs text-zinc-500">
                              {projectName !== '—' ? `${projectName} · ` : ''}
                              {runtimeLabel(agent.runtime) ?? '—'}
                              {agent.configuredModel ? ` · ${agent.configuredModel}` : ''}
                              {agent.version ? ` · ${agent.version}` : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {/* STATE — lifecycle, via the canonical label (labels.ts),
                          never recomputed here. */}
                      <TableCell className="py-2!">
                        <Badge color={stateBadgeColor} className="gap-1.5 uppercase tracking-normal">
                          <span aria-hidden="true" className={clsx('size-1.5 shrink-0 rounded-full', stateDot)} />
                          {copilotStatusLabel(agent.lifecycleStatus)}
                        </Badge>
                      </TableCell>
                      {/* EXECUTABLE — a separate signal from State on purpose: the
                          run gate's own truth, so an active-but-blocked agent cannot
                          misread as simply "active" the way a single merged column
                          would let it. */}
                      <TableCell className="hidden py-2! sm:table-cell">
                        <span
                          className={clsx(
                            'font-mono text-xs tabular-nums',
                            agent.executable ? 'text-accent-500' : 'text-zinc-500'
                          )}
                        >
                          {agentExecutableLabel(agent.executable)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden py-2! text-right md:table-cell">
                        {agent.lastRunAt ? (
                          <>
                            <div className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                              {formatRelativeCompact(agent.lastRunAt, now)}
                            </div>
                            {lastRunLabel ? (
                              <div className="truncate text-[11px] text-zinc-500">{lastRunLabel}</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-zinc-500">Never</span>
                        )}
                      </TableCell>
                      {/* Success — health.testPassRate, run-backed only. No test
                          evidence (no runs ever) renders NotMeasuredDash, never 0%. */}
                      <TableCell className="hidden py-2! text-right font-mono text-sm tabular-nums text-zinc-600 lg:table-cell dark:text-zinc-400">
                        {hasSuccessSignal ? formatPercent(health!.health.testPassRate) : <NotMeasuredDash />}
                      </TableCell>
                      {/* Cost 24h — health.costLast24hUsd, gated on runsLast24h > 0
                          (same rule as the dashboard project table): zero runs in the
                          window is an absent measurement, not a real $0. */}
                      <TableCell className="hidden py-2! text-right font-mono text-sm tabular-nums text-zinc-600 lg:table-cell dark:text-zinc-400">
                        {hasCost24hSignal ? formatUsd(health!.health.costLast24hUsd) : <NotMeasuredDash />}
                      </TableCell>
                      <TableCell className="py-2! pr-4! text-right">
                        <span
                          className={clsx(
                            'font-mono text-xs tabular-nums',
                            agent.executable ? 'text-accent-500' : 'text-zinc-500'
                          )}
                        >
                          {actionText}
                        </span>
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
