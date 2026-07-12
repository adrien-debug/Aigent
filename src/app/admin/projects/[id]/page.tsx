import { ChevronLeftIcon, CodeBracketIcon } from '@heroicons/react/16/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { ProjectDeleteAction } from '@/components/agent-ops/project-delete-action'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProject, getRecentRunsForProject } from '@/lib/agent-mission-control/data'
import {
  formatDurationMs,
  formatPercent,
  formatTimestamp,
  formatUsd,
} from '@/lib/agent-mission-control/format'
import { AGENT_RUNTIME_LABELS, PROJECT_PLATFORM_LABELS } from '@/lib/agent-mission-control/labels'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const project = await getProject(id)
  return {
    title: project
      ? `${project.name} — Projects — Agent Mission Control`
      : 'Project — Agent Mission Control',
  }
}

const numberFormat = new Intl.NumberFormat('en-US')

/** "—" zinc placeholder with an sr-only explanation — absent data is never rendered as 0. */
function EmDash({ srLabel }: { srLabel: string }) {
  return (
    <span className="text-zinc-500">
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  )
}

/** Status enum → plain human label (no badge, no colour): "needs-confirmation" → "Needs confirmation". */
function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}
const runStatusLabel = statusLabel
const copilotStatusLabel = statusLabel

/** The project's validated copilots — Name (slug · runtime · model) / Status / Tests / Runs 24h / Cost 24h. */
function ValidatedAgentsTable({ copilots }: { copilots: Copilot[] }) {
  return (
    <div className="px-6 [--gutter:--spacing(6)]">
      <Table striped bleed>
        {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
        <caption className="sr-only">Validated agents on this project</caption>
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader className="text-right">Tests</TableHeader>
            <TableHeader className="text-right">Runs 24h</TableHeader>
            <TableHeader className="text-right">Cost 24h</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {copilots.map((copilot) => (
            <TableRow key={copilot.id}>
              <TableCell>
                <div className="min-w-0">
                  <div className="truncate font-medium text-zinc-950 dark:text-white">
                    <Link href={`/admin/agents/${copilot.id}`} title={copilot.name} className="hover:underline">
                      {copilot.name}
                    </Link>
                  </div>
                  <div className="mt-1 truncate font-mono text-xs text-zinc-500">
                    {copilot.slug} · {AGENT_RUNTIME_LABELS[copilot.runtime]} · {copilot.model}
                  </div>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                {copilotStatusLabel(copilot.status)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {copilot.health.testPassRate > 0 ? (
                  formatPercent(copilot.health.testPassRate)
                ) : (
                  <EmDash srLabel="Untested" />
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {numberFormat.format(copilot.health.runsLast24h)}
              </TableCell>
              <TableCell className="text-right font-mono text-sm tabular-nums text-zinc-700 dark:text-zinc-300">
                {copilot.health.runsLast24h > 0 ? (
                  formatUsd(copilot.health.costLast24hUsd)
                ) : (
                  <EmDash srLabel="No runs in the last 24 hours" />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

/**
 * Recent traces table — ported from the retired global /admin/traces page
 * (same RunStatusText treatment, LangSmith violet Open link, flush Catalyst
 * Table), scoped to this project's runs. The run id folds into the Copilot
 * cell as a mono sub-line (NameCell slug idiom) so the table stays at 7 columns.
 */
function ProjectTracesTable({
  runs,
  copilotNameById,
}: {
  runs: AgentRun[]
  copilotNameById: Map<string, string>
}) {
  return (
    <div className="px-6 [--gutter:--spacing(6)]">
      <Table striped bleed dense>
        {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
        <caption className="sr-only">Recent traced runs for this project</caption>
        <TableHead>
          <TableRow>
            <TableHeader>Copilot</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Input</TableHeader>
            <TableHeader className="text-right">Latency</TableHeader>
            <TableHeader className="text-right">Cost</TableHeader>
            <TableHeader className="text-right">Started</TableHeader>
            <TableHeader>
              <span className="sr-only">Trace</span>
            </TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell className="whitespace-nowrap">
                <div className="min-w-0">
                  <Link
                    href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                    className="text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                  >
                    {copilotNameById.get(run.copilotId) ?? run.copilotId}
                    <span className="sr-only"> — inspect run {run.id}</span>
                  </Link>
                  <div className="mt-1 font-mono text-xs tabular-nums text-zinc-500">{run.id}</div>
                </div>
              </TableCell>
              <TableCell className="whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                {runStatusLabel(run.status)}
              </TableCell>
              {/* max-w-0 + w-full : la colonne Input absorbe la largeur restante et tronque — jamais de scroll latéral. */}
              <TableCell className="w-full max-w-0">
                <span title={run.inputSummary} className="block truncate text-zinc-500 dark:text-zinc-400">
                  {run.inputSummary}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatDurationMs(run.latencyMs)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatUsd(run.costUsd)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-500">
                {formatTimestamp(run.startedAt).replace(' UTC', '')}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                {run.traceUrl ? (
                  <Link
                    href={run.traceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center rounded-md p-1 text-accent-600 hover:bg-accent-500/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-400"
                  >
                    <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-4" />
                    <span className="sr-only">Open trace for run {run.id} in LangSmith</span>
                  </Link>
                ) : (
                  <span className="sr-only">No trace</span>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const [project, copilots, runs] = await Promise.all([
    getProject(id),
    getCopilots(),
    getRecentRunsForProject(id, 20),
  ])
  if (!project) notFound()

  // Assigned to this project = VALIDATED — the project's agent list.
  const validated = copilots.filter((copilot) => copilot.projectId === project.id)
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  const activeCount = validated.filter((copilot) => copilot.status === 'active').length
  const runsLast24h = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const costLast24hUsd = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  return (
    <div className="space-y-8">
      <div>
        {/* Ligne d'orientation compacte — back-link + méta du projet (plateforme, repo).
            Ne porte plus le titre : le H1 vit dans AgentPageHeader ci-dessous (canon DS). */}
        <nav aria-label="Breadcrumb" className="mt-2 flex min-w-0 items-center gap-2 text-xs">
          <Link
            href="/admin/projects"
            className="inline-flex items-center gap-1 text-zinc-500 hover:text-zinc-950 dark:hover:text-white"
          >
            <ChevronLeftIcon aria-hidden="true" className="size-3.5 shrink-0" />
            Projects
          </Link>
          <span aria-hidden="true" className="text-zinc-500">
            /
          </span>
          <span className="font-mono text-zinc-500">{PROJECT_PLATFORM_LABELS[project.platform]}</span>
          {project.repoUrl && project.repoFullName ? (
            <>
              <span aria-hidden="true" className="text-zinc-500">
                ·
              </span>
              <Link
                href={project.repoUrl}
                target="_blank"
                rel="noreferrer"
                title={project.repoFullName}
                className="inline-flex min-w-0 items-center gap-1.5 font-mono text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
              >
                <CodeBracketIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{project.repoFullName}</span>
                <span className="sr-only">GitHub repository (opens in a new tab)</span>
              </Link>
            </>
          ) : null}
        </nav>

        {/* H1 canon — titre réel du projet, actions (delete) alignées à droite. */}
        <AgentPageHeader
          title={project.name}
          actions={<ProjectDeleteAction project={{ id: project.id, name: project.name }} />}
          className="mt-3"
        />

        {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
        <AgentKpiBand
          className="mt-6"
          stats={[
            {
              name: 'Agents',
              value: String(validated.length),
              hint: 'validated on this project',
            },
            {
              name: 'Active',
              value: String(activeCount),
              hint: `of ${validated.length}`,
            },
            {
              name: 'Runs 24h',
              value: runsLast24h.toLocaleString('en-US'),
            },
            {
              name: 'Cost 24h',
              value: runsLast24h > 0 ? formatUsd(costLast24hUsd) : '—',
              hint: runsLast24h > 0 ? undefined : 'No runs in the last 24 hours',
            },
          ]}
        />
      </div>

      <AgentSectionCard
        title="Agents"
        actions={<span className="text-xs text-zinc-500 tabular-nums">{validated.length}</span>}
        contentClassName="p-0"
      >
        {validated.length > 0 ? (
          <ValidatedAgentsTable copilots={validated} />
        ) : (
          <p className="px-6 py-5 text-sm text-zinc-500 dark:text-zinc-400">
            No validated agents yet — validate copilots from{' '}
            <Link
              href="/admin/agents"
              className="font-medium text-accent-700 hover:text-accent-600 dark:text-accent-400 dark:hover:text-accent-300"
            >
              the bench
            </Link>
            .
          </p>
        )}
      </AgentSectionCard>

      <AgentSectionCard
        title="Traces"
        actions={<span className="text-xs text-zinc-500 tabular-nums">{runs.length}</span>}
        contentClassName="p-0"
      >
        {runs.length > 0 ? (
          <ProjectTracesTable runs={runs} copilotNameById={copilotNameById} />
        ) : (
          <p className="px-6 py-5 text-sm text-zinc-500 dark:text-zinc-400">
            No runs recorded yet. Traces appear here as soon as this project&apos;s agents serve traffic.
          </p>
        )}
      </AgentSectionCard>
    </div>
  )
}
