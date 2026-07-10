import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { passRateClassName } from '@/components/agent-ops/health-format'
import { RunStatusBadge } from '@/components/agent-ops/run-detail-panel'
import { RuntimeBadge } from '@/components/agent-ops/runtime-badge'
import { StatusBadge } from '@/components/agent-ops/status-badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProject, getRecentRunsForProject } from '@/lib/agent-mission-control/data'
import {
  formatDurationMs,
  formatPercent,
  formatTimestamp,
  formatUsd,
} from '@/lib/agent-mission-control/format'
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

/** The project's validated copilots — Name / Runtime / Status / Tests / Runs 24h / Cost 24h. */
function ValidatedAgentsTable({ copilots }: { copilots: Copilot[] }) {
  return (
    <div className="px-6 [--gutter:--spacing(6)]">
      <Table bleed>
        {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
        <caption className="sr-only">Validated agents on this project</caption>
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader>Runtime</TableHeader>
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
                  <div className="mt-1 truncate font-mono text-xs text-zinc-500">{copilot.slug}</div>
                </div>
              </TableCell>
              <TableCell>
                <RuntimeBadge runtime={copilot.runtime} />
              </TableCell>
              <TableCell>
                <StatusBadge status={copilot.status} />
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {copilot.health.testPassRate > 0 ? (
                  <span className={passRateClassName(copilot.health.testPassRate)}>
                    {formatPercent(copilot.health.testPassRate)}
                  </span>
                ) : (
                  <EmDash srLabel="Untested" />
                )}
              </TableCell>
              <TableCell className="text-right font-mono text-zinc-700 tabular-nums dark:text-zinc-300">
                {numberFormat.format(copilot.health.runsLast24h)}
              </TableCell>
              <TableCell className="text-right font-mono tabular-nums">
                {copilot.health.runsLast24h > 0 ? (
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {formatUsd(copilot.health.costLast24hUsd)}
                  </span>
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
 * (same RunStatusBadge treatment, LangSmith violet Open link, flush Catalyst
 * Table), scoped to this project's runs.
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
      <Table bleed dense>
        {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
        <caption className="sr-only">Recent traced runs for this project</caption>
        <TableHead>
          <TableRow>
            <TableHeader>Run</TableHeader>
            <TableHeader>Copilot</TableHeader>
            <TableHeader>Status</TableHeader>
            <TableHeader>Input</TableHeader>
            <TableHeader>Latency</TableHeader>
            <TableHeader>Cost</TableHeader>
            <TableHeader>Started</TableHeader>
            <TableHeader>Trace</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {runs.map((run) => (
            <TableRow key={run.id}>
              <TableCell>
                <span className="font-mono text-xs font-medium tabular-nums text-zinc-950 dark:text-white">
                  {run.id}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Link
                  href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                  className="text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                >
                  {copilotNameById.get(run.copilotId) ?? run.copilotId}
                  <span className="sr-only"> — inspect run {run.id}</span>
                </Link>
              </TableCell>
              <TableCell>
                <RunStatusBadge status={run.status} />
              </TableCell>
              {/* max-w-0 + w-full : la colonne Input absorbe la largeur restante et tronque — jamais de scroll latéral. */}
              <TableCell className="w-full max-w-0">
                <span title={run.inputSummary} className="block truncate text-zinc-500 dark:text-zinc-400">
                  {run.inputSummary}
                </span>
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatDurationMs(run.latencyMs)}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatUsd(run.costUsd)}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500">
                {formatTimestamp(run.startedAt).replace(' UTC', '')}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {run.traceUrl ? (
                  // Famille violet/blue = runtime & tracing UNIQUEMENT — ici c'est le cas légitime (lien LangSmith).
                  <Link
                    href={run.traceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent-500/10 px-2 py-1 text-xs font-medium text-accent-600 hover:bg-accent-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 dark:text-accent-400"
                  >
                    Open
                    <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
                    <span className="sr-only"> trace for run {run.id} in LangSmith</span>
                  </Link>
                ) : (
                  <span className="text-xs text-zinc-500">No trace</span>
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
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          { name: 'Agents', value: String(validated.length), hint: 'validated on this project' },
          { name: 'Active', value: String(activeCount) },
          { name: 'Runs 24h', value: runsLast24h.toLocaleString('en-US') },
          {
            name: 'Cost 24h',
            value: runsLast24h > 0 ? formatUsd(costLast24hUsd) : '—',
            hint: runsLast24h > 0 ? undefined : 'No runs in the last 24 hours',
          },
        ]}
      />

      <AgentSectionCard
        title="Agents"
        description={`Validated copilots assigned to ${project.name} — assignment is the act of validation.`}
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
        description="Runs from this project's agents — deep links open in LangSmith."
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
