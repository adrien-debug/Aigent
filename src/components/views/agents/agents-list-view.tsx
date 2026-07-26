import clsx from 'clsx'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { EmptyState, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import { Badge } from '@/components/ui/badge'
import { surfaceRaised } from '@/components/ui/panel'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatPercent, formatRelativeCompact, formatUsd } from '@/lib/agent-mission-control/format'
import {
  AGENT_RUN_STATUS_LABELS,
  AGENT_STATUS_DIMENSION_LABELS,
  agentExecutableLabel,
  copilotStatusLabel,
  runtimeLabel,
} from '@/lib/agent-mission-control/labels'
import type { AgentsListPageData } from '@/lib/agent-mission-control/agents-list-page-data'
import type { AgentRunStatus } from '@/lib/agent-mission-control/types'

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
  // DESIGN-DOCTRINE.md:108 puts archived in the neutral group with draft/paused.
  // It was the single most saturated badge of the whole list — an archived agent,
  // i.e. one deliberately taken out of service, shouted louder than an active
  // one. The dot on the same row was already `ring-zinc-600`, so the two channels
  // of the same row contradicted each other.
  archived: 'zinc',
}

const STATE_DOT: Record<string, string> = {
  active: 'bg-accent-500',
  degraded: 'bg-zinc-500 ring-2 ring-zinc-500/30',
  paused: 'bg-zinc-600',
  draft: 'bg-transparent ring-1 ring-zinc-600',
  archived: 'bg-transparent ring-1 ring-zinc-600',
}

export function AgentsListView({ agents, projectNameById, healthByCopilotId, now }: AgentsListPageData) {
  return (
    <PageLayout>
      <PageHeader
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
                      what remains always fits — no horizontal page scroll.

                      Two measured fixes, same root cause: the six secondary
                      widths were CONSTANT across every breakpoint, and under
                      `table-fixed` a declared px width is served first, so the
                      Agent column — the only one with no declared width — took
                      the whole shortfall. At 1024px (table 680px) the six kept
                      their full 656px, Agent measured 24px and the name box 0px:
                      the agent name was not truncated, it was INVISIBLE.
                        1. The secondary widths step DOWN one notch below xl and
                           return to their previous value at xl and above, so
                           >=1280px renders exactly as before (Agent 280px at
                           1280, 600px at 1600). Each shrunk width still clears
                           its header's intrinsic width, measured.
                        2. Success and Cost 24h move lg -> xl. Seven columns do
                           not fit 680px whatever the widths: even at their
                           measured minima the six secondaries need ~512px and
                           leave Agent 168px. They return at 1280px, where the
                           table is wide enough to carry all seven.
                      Percentages were tried first and rejected on evidence: a
                      `%` inside `min()` is not resolvable during the fixed-table
                      sizing pass and Chromium dropped every width back to an
                      equal 1/7 share.

                        3. State drops below sm too, so 390px carries Agent +
                           Action only. Before that, the table was Agent(150) +
                           State(96) + Action(112) on a 358px table: the agent
                           name box measured 74px — about eight characters — and
                           every lifecycle badge overflowed its column. Agent now
                           measures 230px there, and the state folds into the
                           agent cell in words.

                      `pl-4!` and `pr-4!` on this header row are the two markers
                      of this file that are NOT redundant, MEASURED both ways:
                      the primitive's own edge padding is `first:pl-(--gutter,
                      --spacing(2))` plus `sm:first:pl-1`, i.e. behind variants.
                      tailwind-merge only merges classes sharing the SAME variant
                      set, so a bare `pl-4` does not replace them, and it loses
                      the cascade to a `:first-child` selector on specificity.
                      Dropping the marker measured 16px -> 4px (>=sm) and
                      16px -> 0px (<sm) on both edge columns, at every width
                      tested. They stay, and they stay in the v4 suffix form. */}
                  <TableHeader className="pl-4!">Agent</TableHeader>
                  {/* STATE — the operator's lifecycle decision. Distinct from
                      Executable: an agent can be `active` (state) and still not
                      executable (an unresolved tool), and the two columns must
                      never be collapsed into one or that contradiction becomes
                      unreadable.

                      Width comes from the WIDEST badge, measured, not from the
                      header word. Under `table-fixed` a declared width is served
                      first and the content is NOT shrunk to fit — it escapes the
                      column and paints over the next one. Measured badge widths
                      against the cell's content box (column width minus the
                      primitive's px-4):
                        <sm  box 64px — Draft 68, Active 72, Paused 77,
                                        Archived 94, Degraded 100 → ALL six spill
                        sm-lg box 80px — Degraded 89, Archived 84 → 2 spill
                        xl    box 96px — nothing spills
                      So `sm:w-28` (box 80) was too narrow for the two longest
                      lifecycle labels at every width from 640 to 1279, and the
                      overflow was invisible in review because it lands on the
                      neighbouring column, not on the page edge.
                      `sm:w-32` (box 96) clears the measured 89px maximum with
                      7px to spare, which is also the xl value — one width from
                      640px up, no step. Below sm the column is DROPPED and the
                      state folds into the Agent cell (see there): at 358px of
                      table, no width both fits a 100px badge and leaves the
                      agent name a readable box. */}
                  <TableHeader className="hidden w-32 sm:table-cell">
                    {AGENT_STATUS_DIMENSION_LABELS.lifecycle}
                  </TableHeader>
                  <TableHeader className="hidden w-24 sm:table-cell">
                    {AGENT_STATUS_DIMENSION_LABELS.executable}
                  </TableHeader>
                  <TableHeader className="hidden w-24 text-right md:table-cell xl:w-28">Last run</TableHeader>
                  <TableHeader className="hidden w-20 text-right xl:table-cell">Success</TableHeader>
                  <TableHeader className="hidden w-24 text-right xl:table-cell">
                    Cost<span className="sr-only"> over the last 24 hours</span>
                    {/* zinc-400, not -500: the header plane is the sunken band
                        (rgb(13,13,16)) where check-contrast measures -500 at
                        4.02:1 against a 4.5 threshold. */}
                    <span aria-hidden="true" className="ml-1 font-normal text-zinc-400">24h</span>
                  </TableHeader>
                  {/* Same measured rule as State. The widest action label in
                      this database is "1 tool unresolved" at 92px; the base
                      `w-28` gave it a 80px box, so it spilled 12px into the
                      cell's own right padding below 640px. `w-32` (box 96)
                      clears it. From sm up the column was already 128px, which
                      measured fine, so only the base rung moves. */}
                  <TableHeader className="w-32 pr-4! text-right xl:w-36">Action</TableHeader>
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
                  // testPassRate is a PLACEHOLDER 0 when unproven (data.ts) — gate
                  // on healthUnavailableFields, NOT healthEvidence (true for a
                  // benchmark-only agent whose testPassRate is 0 → fabricated 0%).
                  const hasSuccessSignal =
                    health?.healthUnavailableFields !== undefined &&
                    !health.healthUnavailableFields.includes('testPassRate')
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
                      {/* py-2 pins the row to the h-14 set above, matching the
                          projects table on the cockpit so the two read as one
                          rhythm instead of two densities.

                          It no longer needs `!important`: `TableCell` composes
                          `cn(defaults…, className)`, so tailwind-merge drops the
                          primitive's own `py-4` before the browser sees the list.
                          MEASURED both ways at 1440/768/390 — cell padding
                          8px|8px and row height 56px, identical with and without
                          the marker. The two `pl-4!`/`pr-4!` on this table are
                          the opposite case and are documented where they sit. */}
                      <TableCell className="py-2 pl-4!">
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
                            {/* zinc-400, not -500: check-contrast measures -500 at
                                3.59:1 on this raised plane (rgb(26,26,30)) for a
                                4.5 threshold. Same call, same reason as
                                dashboard-kpi-strip.tsx; the shell is hard-dark
                                (`class="dark"` on <html>) so a bare zinc-400 has
                                no light-mode counterpart to break. */}
                            <div className="truncate font-mono text-xs text-zinc-400">
                              {/* Below sm the State column is dropped, so the
                                  lifecycle folds in here rather than vanishing —
                                  same rule as the runs/cost fold on the projects
                                  table. It leads the line because it is the most
                                  load-bearing fact of the row and the line
                                  truncates from the right. Words, not a badge:
                                  the canonical label (labels.ts) is the channel,
                                  and no colour is spent restating it. */}
                              <span className="sm:hidden">
                                {copilotStatusLabel(agent.lifecycleStatus)} ·{' '}
                              </span>
                              {projectName !== '—' ? `${projectName} · ` : ''}
                              {runtimeLabel(agent.runtime) ?? '—'}
                              {agent.configuredModel ? ` · ${agent.configuredModel}` : ''}
                              {agent.version ? ` · ${agent.version}` : ''}
                            </div>
                          </div>
                        </div>
                      </TableCell>
                      {/* STATE — lifecycle, via the canonical label (labels.ts),
                          never recomputed here. Hidden below sm in step with its
                          header; the same label is folded into the Agent cell
                          above, so nothing is lost. */}
                      <TableCell className="hidden py-2 sm:table-cell">
                        <Badge color={stateBadgeColor} className="gap-1.5 uppercase tracking-normal">
                          <span aria-hidden="true" className={clsx('size-1.5 shrink-0 rounded-full', stateDot)} />
                          {copilotStatusLabel(agent.lifecycleStatus)}
                        </Badge>
                      </TableCell>
                      {/* EXECUTABLE — a separate signal from State on purpose: the
                          run gate's own truth, so an active-but-blocked agent cannot
                          misread as simply "active" the way a single merged column
                          would let it. */}
                      <TableCell className="hidden py-2 sm:table-cell">
                        <span
                          className={clsx(
                            'font-mono text-xs tabular-nums',
                            agent.executable ? 'text-accent-500' : 'text-zinc-400'
                          )}
                        >
                          {agentExecutableLabel(agent.executable)}
                        </span>
                      </TableCell>
                      <TableCell className="hidden py-2 text-right md:table-cell">
                        {agent.lastRunAt ? (
                          <>
                            <div className="font-mono text-xs tabular-nums text-zinc-600 dark:text-zinc-400">
                              {formatRelativeCompact(agent.lastRunAt, now)}
                            </div>
                            {/* Same zinc-400 as its sibling below. This branch
                                renders on no agent in the current database, so
                                the gate cannot see it — but the ratio depends on
                                the colour pair alone, and zinc-500 on the raised
                                plane is 3.59:1 at ANY size under 24px. Leaving it
                                at -500 would ship a sub-AA label the day the
                                first run lands. */}
                            {lastRunLabel ? (
                              <div className="truncate text-[11px] text-zinc-400">{lastRunLabel}</div>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-xs text-zinc-400">Never</span>
                        )}
                      </TableCell>
                      {/* Success — health.testPassRate, run-backed only. No test
                          evidence (no runs ever) renders NotMeasuredDash, never 0%. */}
                      <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 xl:table-cell dark:text-zinc-400">
                        {hasSuccessSignal ? formatPercent(health!.health.testPassRate) : <NotMeasuredDash />}
                      </TableCell>
                      {/* Cost 24h — health.costLast24hUsd, gated on runsLast24h > 0
                          (same rule as the dashboard project table): zero runs in the
                          window is an absent measurement, not a real $0. */}
                      <TableCell className="hidden py-2 text-right font-mono text-sm tabular-nums text-zinc-600 xl:table-cell dark:text-zinc-400">
                        {hasCost24hSignal ? formatUsd(health!.health.costLast24hUsd) : <NotMeasuredDash />}
                      </TableCell>
                      <TableCell className="py-2 pr-4! text-right">
                        <span
                          className={clsx(
                            'font-mono text-xs tabular-nums',
                            agent.executable ? 'text-accent-500' : 'text-zinc-400'
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
    </PageLayout>
  )
}
