import { ServerStackIcon, CpuChipIcon, BoltIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'

import { AgentKpiBand, type AgentKpiStat } from '@/components/agent-ops/agent-kpi-band'
import { EmptyStatePanel, NotMeasuredDash } from '@/components/agent-ops/empty-state'
import { ProjectDeleteAction } from '@/components/agent-ops/project-delete-action'
import { ProjectHeader } from '@/components/agent-ops/project-header'
import { ProjectMissionOrchestrator } from '@/components/agent-ops/project-mission-orchestrator'
import { ProjectRepoIntelligence } from '@/components/agent-ops/project-repo-intelligence'
import { ProvisionConsumerCard } from '@/components/agent-ops/provision-consumer-card'
import { ProjectTabs } from '@/components/agent-ops/project-tabs'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { SoftAccentLink } from '@/components/agent-ops/soft-accent-link'
import { PageLayout } from '@/components/shell/page-layout'
import { Section } from '@/components/ui/section'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  formatDurationMs,
  formatPercent,
  formatTimestamp,
  formatUsd,
} from '@/lib/agent-mission-control/format'
import {
  AGENT_RUNTIME_LABELS,
  AGENT_RUN_STATUS_LABELS,
  COPILOT_STATUS_LABELS,
  VERSION_STAGE_LABELS,
} from '@/lib/agent-mission-control/labels'
import type { ProjectDetailPageData } from '@/lib/agent-mission-control/project-detail-page-data'
import type { AgentRun, AgentRunStatus, Copilot, DisplayStatus } from '@/lib/agent-mission-control/types'

const numberFormat = new Intl.NumberFormat('en-US')

/**
 * `DisplayStatus` is `CopilotStatus | 'production'` and labels.ts — the single
 * home of display labels — exports no table for that union yet. Composed from
 * the two tables it DOES export so this file holds zero literal label string.
 * Replace with a `DISPLAY_STATUS_LABELS` export the moment labels.ts ships one.
 */
const DISPLAY_STATUS_LABELS: Record<DisplayStatus, string> = {
  ...COPILOT_STATUS_LABELS,
  production: VERSION_STAGE_LABELS.production,
}

/**
 * Lifecycle status = muted TEXT, never a pill (DESIGN-DOCTRINE.md, "Composants";
 * `RunStatusText` in run-detail-panel.tsx is the reference pattern). Both tables
 * on this page used to render a `Badge`, and both put success and failure in the
 * SAME accent branch (`completed || failed` → accent, `active || degraded` →
 * accent): a failed run and a broken agent were painted with the colour of a
 * healthy one.
 *
 * Three tones, and no green: `accent` stays out of lifecycle text per doctrine.
 *   - failure (`failed`, `degraded`) → the `--state-danger-*` role. `degraded`
 *     belongs here because it means the agent declares tools with no registered
 *     handler — it cannot run (AGENTS.md), it is not a mild warning.
 *   - resolved-and-healthy (`completed`, `active`, `production`) → full-strength
 *     zinc, the "nothing to look at" baseline.
 *   - everything else (`running`, `blocked`, `needs-confirmation`, `draft`,
 *     `paused`, `archived`) → muted zinc. Not-finished and not-deployed are not
 *     incidents.
 * The label always states the status, so the tone is reinforcement, never the
 * only carrier of meaning.
 */
const statusTextClass = 'text-xs font-medium uppercase tracking-widest'
const STATUS_TONE = {
  danger: 'text-[var(--state-danger-text)]',
  resolved: 'text-zinc-300',
  muted: 'text-zinc-500',
} as const

function RunStatusTone({ status }: { status: AgentRunStatus }) {
  const tone = status === 'failed' ? 'danger' : status === 'completed' ? 'resolved' : 'muted'
  return <span className={`${statusTextClass} ${STATUS_TONE[tone]}`}>{AGENT_RUN_STATUS_LABELS[status]}</span>
}

function CopilotStatusTone({ status }: { status: DisplayStatus }) {
  const tone =
    status === 'degraded'
      ? 'danger'
      : status === 'active' || status === 'production'
        ? 'resolved'
        : 'muted'
  return <span className={`${statusTextClass} ${STATUS_TONE[tone]}`}>{DISPLAY_STATUS_LABELS[status]}</span>
}

function ValidatedAgentsTable({ copilots }: { copilots: Copilot[] }) {
  return (
    <Section title="Validated Agents" contentClassName="" actions={<span className="text-xs text-zinc-500">{copilots.length} total</span>}>
      {/* No `dense` here, and no `py-4` on the cells either: py-4 IS the
          primitive's default, so repeating it on all six cells only suggested
          the padding was decided locally. Removed rather than kept — the
          rendered pixels are unchanged, the false ownership is gone. */}
      <Table className="w-full text-left border-collapse px-6 [--gutter:--spacing(0)]">
        <TableHead>
          <TableRow className="border-b border-white/5">
            <TableHeader>Agent Identity</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader className="hidden md:table-cell">Model & Runtime</TableHeader>
            <TableHeader className="text-right">Pass Rate</TableHeader>
            <TableHeader className="hidden text-right lg:table-cell">24h Volume</TableHeader>
            <TableHeader className="text-right">24h Cost</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y divide-white/5">
          {copilots.map((copilot) => (
            // Same shape as AgentLeaderboard: the row had a local hover fill but no
            // `href`, so it lit up without being navigable — a promise the row could
            // not keep. It has a single destination, so `href` moves to the row: the
            // primitive then paints the hover AND the keyboard focus ring, and the
            // whole row becomes the target. The inner <Link> loses its own href to
            // avoid two tab stops on one URL.
            <TableRow key={copilot.id} href={`/admin/agents/${copilot.id}`} title={copilot.name}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">{copilot.name}</span>
                    <span className="text-[10px] font-mono text-zinc-500 mt-0.5">{copilot.slug}</span>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <CopilotStatusTone status={copilot.displayStatus ?? copilot.status} />
              </TableCell>
              <TableCell className="hidden md:table-cell">
                <div className="flex flex-col">
                  <span className="text-xs text-zinc-300">{copilot.model}</span>
                  <span className="text-[10px] text-zinc-500 mt-0.5">{AGENT_RUNTIME_LABELS[copilot.runtime]}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                {copilot.healthEvidence === 'runs' ? (
                  <div className="flex flex-col items-end gap-1">
                    <span className={`text-sm font-mono ${copilot.health.testPassRate >= 0.9 ? 'text-accent-400' : 'text-zinc-300'}`}>
                      {formatPercent(copilot.health.testPassRate)}
                    </span>
                    <div className="w-16 h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full bg-accent-500" style={{ width: `${copilot.health.testPassRate * 100}%` }} />
                    </div>
                  </div>
                ) : (
                  <span className="text-xs text-zinc-600">—</span>
                )}
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                <span className="text-sm font-mono text-white">{numberFormat.format(copilot.health.runsLast24h)}</span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-sm font-mono text-zinc-400">
                  {copilot.health.runsLast24h > 0 ? formatUsd(copilot.health.costLast24hUsd) : '—'}
                </span>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

function ProjectTracesTable({ runs, copilotNameById }: { runs: AgentRun[], copilotNameById: Map<string, string> }) {
  return (
    <Section title="Recent Traces" contentClassName="" actions={<span className="text-xs text-zinc-500">{runs.length} runs</span>}>
      {/* `dense`, not `className="py-3"` on every cell: TableCell composes
          `clsx(className, …, dense ? 'py-3' : 'py-4')`, so the caller's py-3 and
          the primitive's py-4 have equal specificity and Tailwind's stylesheet
          order picks py-4 — the seven overrides below rendered nothing and only
          told the reader a lie. `dense` emits ONE value, so there is no race. */}
      <Table dense className="w-full text-left border-collapse px-6 [--gutter:--spacing(0)]">
        <TableHead>
          <TableRow className="border-b border-white/5">
            <TableHeader>Run ID & Copilot</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader className="w-1/3">Input Summary</TableHeader>
            <TableHeader className="text-right">Latency</TableHeader>
            <TableHeader className="hidden text-right lg:table-cell">Cost</TableHeader>
            <TableHeader className="hidden text-right md:table-cell">Started</TableHeader>
            <TableHeader className="text-center">Trace</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody className="divide-y divide-white/5">
          {runs.map((run) => (
            <TableRow key={run.id} href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`} title={run.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="truncate text-sm font-medium text-white">
                    {copilotNameById.get(run.copilotId) ?? run.copilotId}
                  </span>
                  <span className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">{run.id}</span>
                </div>
              </TableCell>
              <TableCell>
                <RunStatusTone status={run.status} />
              </TableCell>
              <TableCell>
                <span className="block text-xs text-zinc-400 truncate max-w-md" title={run.inputSummary}>
                  {run.inputSummary}
                </span>
              </TableCell>
              <TableCell className="text-right">
                <span className="text-xs font-mono text-zinc-300">{formatDurationMs(run.latencyMs)}</span>
              </TableCell>
              <TableCell className="hidden text-right lg:table-cell">
                <span className="text-xs font-mono text-zinc-400">{formatUsd(run.costUsd)}</span>
              </TableCell>
              <TableCell className="hidden text-right md:table-cell">
                <span className="text-xs font-mono text-zinc-500">{formatTimestamp(run.startedAt).replace(' UTC', '')}</span>
              </TableCell>
              <TableCell className="text-center">
                {run.traceUrl ? (
                  <a
                    href={run.traceUrl}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open trace for run ${run.id} in LangSmith`}
                    title="Open trace in LangSmith"
                    className="inline-flex items-center justify-center size-11 -my-3.5 rounded-md text-zinc-500 outline-offset-2 transition-colors hover:text-accent-400 hover:bg-[var(--accent-soft)] focus-visible:outline-2 focus-visible:outline-accent-500"
                  >
                    <ArrowTopRightOnSquareIcon className="size-4" />
                  </a>
                ) : (
                  <span className="text-zinc-600">—</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Section>
  )
}

/**
 * `/admin/projects/:id` — project detail.
 *
 * Header deviation (documented, deliberate): `ProjectHeader` (agent-ops) is
 * already a self-contained page-identity header — cover photo + avatar +
 * `<Heading>` + description + a children-rendered footer strip for actions —
 * built independently of `shell/page-header.tsx` (zero coupling between the
 * two). It plays the exact role a `PageHeader` would play at the top of this
 * page. Stacking `PageHeader` above it would duplicate the title block, so
 * this view omits `PageHeader` and defers entirely to `ProjectHeader` as the
 * page's sole header — same precedent as `views/projects/project-team-view.tsx`,
 * which also skips `PageHeader` in favour of its own compact identity strip.
 * `PageLayout` still wraps the page for the shared vertical rhythm.
 */
export function ProjectDetailView({ project, validated, runs, copilotNameById, consumerStatus, kpis }: ProjectDetailPageData) {
  const kpiStats: AgentKpiStat[] = [
    {
      name: 'Team',
      value: String(kpis.validatedCount),
      hint: kpis.validatedCount === 1 ? '1 agent assigned' : `${kpis.validatedCount} agents assigned`,
    },
    {
      name: 'Executable',
      value: `${kpis.executableCount} / ${kpis.validatedCount}`,
      valueTone: kpis.executableCount === kpis.validatedCount && kpis.validatedCount > 0 ? 'default' : 'muted',
      hint: 'Active with every declared tool resolved',
    },
    {
      name: 'Runs (24h)',
      content: kpis.hasRunVolumeSignal ? (
        <span className="text-2xl/8 font-light tracking-tight tabular-nums text-white">
          {kpis.runsLast24h.toLocaleString()}
        </span>
      ) : (
        <NotMeasuredDash />
      ),
    },
    {
      name: 'Cost (24h)',
      content: kpis.hasRunVolumeSignal && kpis.runsLast24h > 0 ? (
        <span className="text-2xl/8 font-light tracking-tight tabular-nums text-white">
          {formatUsd(kpis.costLast24hUsd)}
        </span>
      ) : (
        <NotMeasuredDash />
      ),
    },
    {
      name: 'Success',
      content: kpis.successRate === null ? (
        <NotMeasuredDash />
      ) : (
        <span
          className={`text-2xl/8 font-light tracking-tight tabular-nums ${kpis.successRate >= 0.9 ? 'text-accent-400' : 'text-white'}`}
        >
          {formatPercent(kpis.successRate)}
        </span>
      ),
      hint: kpis.finishedRunsCount > 0 ? `${kpis.finishedRunsCount} finished run${kpis.finishedRunsCount > 1 ? 's' : ''}` : undefined,
    },
    {
      name: 'Version served',
      value: `${kpis.servedCount} / ${kpis.validatedCount}`,
      hint: 'Agents with a production version pointer',
    },
  ]

  return (
    <PageLayout className="gap-8 pb-12">
      <ProjectHeader
        project={project}
        actions={<ProjectDeleteAction project={{ id: project.id, name: project.name }} />}
      >
        <ProjectRepoIntelligence projectId={project.id} repoFullName={project.repoFullName ?? null} />
      </ProjectHeader>

      <ProjectTabs projectId={project.id} />

      <AgentKpiBand stats={kpiStats} />

      {project.repoFullName ? (
        <>
          <ProvisionConsumerCard
            projectId={project.id}
            repoFullName={project.repoFullName}
            initialStatus={consumerStatus}
          />
          <ProjectMissionOrchestrator
            projectId={project.id}
            defaultObjective={
              validated.length > 0
                ? `Validate ${validated[0].name} after merged delivery`
                : 'Validate agent delivery readiness for this project'
            }
          />
        </>
      ) : (
        <EmptyStatePanel
          icon={ServerStackIcon}
          title="No repo linked"
          description="Link a GitHub repo to this project to run mission orchestration."
        />
      )}

      {validated.length > 0 ? (
        <ValidatedAgentsTable copilots={validated} />
      ) : (
        <EmptyStatePanel
          icon={CpuChipIcon}
          title="No validated agents"
          description="Provision a copilot for this project to see it here."
          // `SoftAccentLink` is THE accent CTA of the /admin pages (its own
          // doc-comment says so, and both list views already use it for their
          // empty state). This was the one place still shipping a bare
          // `text-accent-400 hover:underline` inline link: measured 96x16 at
          // 768 AND at 390, a target no thumb can hit, with no hit area beyond
          // the glyphs themselves. The pill measures 36px tall, which is the
          // height every other CTA on these pages has.
          action={<SoftAccentLink href="/admin/agents/new">Provision a copilot</SoftAccentLink>}
        />
      )}

      {runs.length > 0 ? (
        <ProjectTracesTable runs={runs} copilotNameById={copilotNameById} />
      ) : (
        <EmptyStatePanel
          icon={BoltIcon}
          title="No runs recorded"
          description="Traces appear here as soon as this project's agents serve traffic."
        />
      )}
    </PageLayout>
  )
}
