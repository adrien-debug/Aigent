import { ServerStackIcon, CpuChipIcon, BoltIcon, ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { SurfaceCard, SurfaceCardHeader } from '@/components/agent-ops/surface-card'
import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { ProjectDeleteAction } from '@/components/agent-ops/project-delete-action'
import { ProjectHeader } from '@/components/agent-ops/project-header'
import { ProjectMissionOrchestrator } from '@/components/agent-ops/project-mission-orchestrator'
import { ProjectRepoIntelligence } from '@/components/agent-ops/project-repo-intelligence'
import { ProvisionConsumerCard } from '@/components/agent-ops/provision-consumer-card'
import { ProjectTabs } from '@/components/agent-ops/project-tabs'
import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProject, getRecentRunsForProject } from '@/lib/agent-mission-control/data'
import { getConsumerProvisionStatus } from '@/lib/agent-mission-control/github'
import {
  formatDurationMs,
  formatPercent,
  formatTimestamp,
  formatUsd,
} from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return {
    title: project
      ? `${project.name} — Projects — Aigent`
      : 'Project — Aigent',
  }
}

const numberFormat = new Intl.NumberFormat('en-US')

function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

function ValidatedAgentsTable({ copilots }: { copilots: Copilot[] }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Validated Agents" meta={<span className="text-xs text-zinc-500">{copilots.length} total</span>} />
      <div className="overflow-x-auto no-scrollbar">
        <Table className="w-full text-left border-collapse min-w-[800px] px-6 [--gutter:--spacing(0)]">
          <TableHead>
            <TableRow className="border-b border-white/5">
              <TableHeader>Agent Identity</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader>Model & Runtime</TableHeader>
              <TableHeader className="text-right">Pass Rate</TableHeader>
              <TableHeader className="text-right">24h Volume</TableHeader>
              <TableHeader className="text-right">24h Cost</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {copilots.map((copilot) => (
              <TableRow key={copilot.id} className="group hover:bg-[var(--color-surface-interactive)] transition-colors">
                <TableCell className="py-4">
                  <div className="flex items-center gap-3">
                    <CopilotAvatar copilot={copilot} className="size-8 rounded-xl" />
                    <div className="flex flex-col">
                      <Link href={`/admin/agents/${copilot.id}`} className="text-sm font-medium text-white group-hover:underline">
                        {copilot.name}
                      </Link>
                      <span className="text-[10px] font-mono text-zinc-500 mt-0.5">{copilot.slug}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="py-4">
                  <Badge
                    color={
                      copilot.displayStatus === 'production' ||
                      copilot.status === 'active' ||
                      copilot.status === 'degraded'
                        ? 'accent'
                        : 'zinc'
                    }
                    className="uppercase tracking-widest"
                  >
                    {statusLabel(copilot.displayStatus ?? copilot.status)}
                  </Badge>
                </TableCell>
                <TableCell className="py-4">
                  <div className="flex flex-col">
                    <span className="text-xs text-zinc-300">{copilot.model}</span>
                    <span className="text-[10px] text-zinc-500 mt-0.5">{AGENT_RUNTIME_LABELS[copilot.runtime]}</span>
                  </div>
                </TableCell>
                <TableCell className="py-4 text-right">
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
                <TableCell className="py-4 text-right">
                  <span className="text-sm font-mono text-white">{numberFormat.format(copilot.health.runsLast24h)}</span>
                </TableCell>
                <TableCell className="py-4 text-right">
                  <span className="text-sm font-mono text-zinc-400">
                    {copilot.health.runsLast24h > 0 ? formatUsd(copilot.health.costLast24hUsd) : '—'}
                  </span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </SurfaceCard>
  )
}

function ProjectTracesTable({ runs, copilotNameById }: { runs: AgentRun[], copilotNameById: Map<string, string> }) {
  return (
    <SurfaceCard>
      <SurfaceCardHeader title="Recent Traces" meta={<span className="text-xs text-zinc-500">{runs.length} runs</span>} />
      <div className="overflow-x-auto no-scrollbar">
        <Table className="w-full text-left border-collapse min-w-[1000px] px-6 [--gutter:--spacing(0)]">
          <TableHead>
            <TableRow className="border-b border-white/5">
              <TableHeader>Run ID & Copilot</TableHeader>
              <TableHeader>Status</TableHeader>
              <TableHeader className="w-1/3">Input Summary</TableHeader>
              <TableHeader className="text-right">Latency</TableHeader>
              <TableHeader className="text-right">Cost</TableHeader>
              <TableHeader className="text-right">Started</TableHeader>
              <TableHeader className="text-center">Trace</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {runs.map((run) => (
              <TableRow key={run.id} className="group hover:bg-[var(--color-surface-interactive)] transition-colors">
                <TableCell className="py-3">
                  <div className="flex flex-col">
                    <Link
                      href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                      className="text-sm font-medium text-white group-hover:underline truncate"
                    >
                      {copilotNameById.get(run.copilotId) ?? run.copilotId}
                    </Link>
                    <span className="text-[10px] font-mono text-zinc-500 mt-0.5 truncate">{run.id}</span>
                  </div>
                </TableCell>
                <TableCell className="py-3">
                  <Badge
                    color={run.status === 'completed' || run.status === 'failed' ? 'accent' : 'zinc'}
                    className="uppercase tracking-widest"
                  >
                    {statusLabel(run.status)}
                  </Badge>
                </TableCell>
                <TableCell className="py-3">
                  <span className="block text-xs text-zinc-400 truncate max-w-md" title={run.inputSummary}>
                    {run.inputSummary}
                  </span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-xs font-mono text-zinc-300">{formatDurationMs(run.latencyMs)}</span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-xs font-mono text-zinc-400">{formatUsd(run.costUsd)}</span>
                </TableCell>
                <TableCell className="py-3 text-right">
                  <span className="text-xs font-mono text-zinc-500">{formatTimestamp(run.startedAt).replace(' UTC', '')}</span>
                </TableCell>
                <TableCell className="py-3 text-center">
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
      </div>
    </SurfaceCard>
  )
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [project, copilots, runs] = await Promise.all([
    getProject(id),
    getCopilots({ health: 'list' }),
    getRecentRunsForProject(id, 20),
  ])
  if (!project) notFound()

  const consumerStatus = project.repoFullName
    ? await getConsumerProvisionStatus(project.repoFullName).catch(() => null)
    : null

  const validated = copilots.filter((copilot) => copilot.projectId === project.id)
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  return (
    <div className="flex flex-col gap-8 pb-12">
      <ProjectHeader
        project={project}
        actions={<ProjectDeleteAction project={{ id: project.id, name: project.name }} />}
      >
        <ProjectRepoIntelligence projectId={project.id} repoFullName={project.repoFullName ?? null} />
      </ProjectHeader>

      <ProjectTabs projectId={project.id} />

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
          action={
            <Link href="/admin/agents/new" className="text-xs text-accent-400 hover:underline">
              Provision a copilot
            </Link>
          }
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
    </div>
  )
}
