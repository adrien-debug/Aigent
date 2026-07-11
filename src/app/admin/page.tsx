import { BoltIcon, CpuChipIcon, FolderIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentPageHeader } from '@/components/agent-ops/agent-page-header'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProjects, getRecentRuns, getRegistryKpis } from '@/lib/agent-mission-control/data'
import { formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot, Project } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Dashboard — Agent Mission Control',
}

const numberFormat = new Intl.NumberFormat('en-US')

/** Status enum → plain human label: "needs-confirmation" → "Needs confirmation". */
function statusLabel(status: string): string {
  const spaced = status.replace(/-/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** "—" zinc placeholder with an sr-only explanation — absent data is never rendered as 0. */
function EmDash({ srLabel }: { srLabel: string }) {
  return (
    <span className="text-zinc-500">
      <span aria-hidden="true">&mdash;</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  )
}

/** Card-footer affordance shared by every card — same slot, same style. */
function ViewAllLink({ href, srSuffix }: { href: string; srSuffix: string }) {
  return (
    <Link
      href={href}
      className="text-sm font-medium text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
    >
      View all <span aria-hidden="true">&rarr;</span>
      <span className="sr-only"> {srSuffix}</span>
    </Link>
  )
}

/** Shared empty-state rhythm (icon + label + hint), identical across cards. */
function CardEmptyState({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof CpuChipIcon
  title: string
  hint: string
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      <Icon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
      <p className="text-sm font-medium text-zinc-950 dark:text-white">{title}</p>
      <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">{hint}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Run activity — the single visual anchor of the page: latency over the run
// window, then a dense table of the latest runs. Nothing else competes with it.
// ---------------------------------------------------------------------------

const ACTIVITY_TABLE_ROWS = 6

function RunActivityCard({
  runs,
  copilotNameById,
}: {
  runs: AgentRun[]
  copilotNameById: Map<string, string>
}) {
  // Chart data: chronological (oldest → newest), plain serializable objects only.
  const latencyPoints = [...runs].reverse().map((run) => ({
    id: run.id,
    label: formatTimestamp(run.startedAt).replace(' UTC', ''),
    latencyMs: run.latencyMs,
    costUsd: run.costUsd,
    status: run.status,
  }))
  const shown = runs.slice(0, ACTIVITY_TABLE_ROWS)

  return (
    <AgentSectionCard
      title="Run activity"
      description="Latency of the latest runs across every copilot."
      actions={<ViewAllLink href="/admin/agents" srSuffix="copilots and their runs" />}
      contentClassName={runs.length > 0 ? 'p-0' : undefined}
    >
      {runs.length > 0 ? (
        <>
          <div className="px-6 py-5">
            <RunLatencyChart data={latencyPoints} />
          </div>
          <div className="border-t border-zinc-950/5 px-6 [--gutter:--spacing(6)] dark:border-white/5">
            <Table striped bleed dense>
              {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
              <caption className="sr-only">Latest runs across every copilot</caption>
              <TableHead>
                <TableRow>
                  <TableHeader>Copilot</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader className="text-right">Cost</TableHeader>
                  <TableHeader className="text-right">Started</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((run) => (
                  <TableRow key={run.id}>
                    {/* max-w-0 + w-full : la colonne Copilot absorbe la largeur restante et tronque — jamais de scroll latéral. */}
                    <TableCell className="w-full max-w-0">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                          className="block truncate text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                        >
                          {copilotNameById.get(run.copilotId) ?? run.copilotId}
                          <span className="sr-only"> — inspect run {run.id}</span>
                        </Link>
                        <div className="mt-1 truncate font-mono text-xs tabular-nums text-zinc-500">{run.id}</div>
                      </div>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm text-zinc-500 dark:text-zinc-400">
                      {statusLabel(run.status)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatUsd(run.costUsd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-500">
                      {formatTimestamp(run.startedAt).replace(' UTC', '')}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <CardEmptyState
          icon={BoltIcon}
          title="No runs yet"
          hint="Runs appear here as soon as a copilot serves traffic."
        />
      )}
    </AgentSectionCard>
  )
}

// ---------------------------------------------------------------------------
// Fleet — plain status roster, one count per lifecycle state. No bars, no gauge.
// ---------------------------------------------------------------------------

const FLEET_STATUSES: Copilot['status'][] = ['active', 'degraded', 'paused', 'draft', 'archived']

function FleetCard({ copilots }: { copilots: Copilot[] }) {
  const degraded = copilots.filter((copilot) => copilot.status === 'degraded').slice(0, 4)

  return (
    <AgentSectionCard
      title="Fleet"
      description="Copilots by lifecycle state."
      actions={<ViewAllLink href="/admin/agents" srSuffix="copilots" />}
    >
      {copilots.length > 0 ? (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            {FLEET_STATUSES.map((status) => {
              const count = copilots.filter((copilot) => copilot.status === status).length
              return (
                <div key={status}>
                  <dt className="text-xs text-zinc-500">{statusLabel(status)}</dt>
                  <dd className="mt-1 font-mono text-2xl font-semibold text-zinc-950 tabular-nums dark:text-white">
                    {count}
                  </dd>
                </div>
              )
            })}
          </dl>

          {degraded.length > 0 ? (
            <div className="border-t border-zinc-950/5 pt-4 dark:border-white/5">
              <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">Degraded copilots</p>
              <div role="list" className="mt-2 divide-y divide-zinc-950/5 dark:divide-white/5">
                {degraded.map((copilot) => (
                  <div role="listitem" key={copilot.id} className="flex items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/admin/agents/${copilot.id}`}
                        title={copilot.name}
                        className="block truncate text-sm font-medium text-zinc-950 hover:underline dark:text-white"
                      >
                        {copilot.name}
                      </Link>
                      <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{copilot.slug}</div>
                    </div>
                    {copilot.health.openWarnings > 0 ? (
                      <Badge color="accentStrong" className="shrink-0">
                        {numberFormat.format(copilot.health.openWarnings)} warning
                        {copilot.health.openWarnings === 1 ? '' : 's'}
                      </Badge>
                    ) : (
                      <span className="shrink-0 font-mono text-xs text-zinc-500 tabular-nums dark:text-zinc-400">
                        <EmDash srLabel="No open warnings" />
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="border-t border-zinc-950/5 pt-4 text-sm text-zinc-500 dark:border-white/5 dark:text-zinc-400">
              No degraded copilots — the whole fleet is serving normally.
            </p>
          )}
        </div>
      ) : (
        <CardEmptyState
          icon={CpuChipIcon}
          title="No copilots yet"
          hint="Register a copilot to see fleet health roll up here."
        />
      )}
    </AgentSectionCard>
  )
}

// ---------------------------------------------------------------------------
// Projects — mini-list with per-project rollup. Text only, no meters.
// ---------------------------------------------------------------------------

interface ProjectRollup {
  copilotCount: number
  activeCount: number
  runsLast24h: number
  costLast24hUsd: number
}

const EMPTY_ROLLUP: ProjectRollup = {
  copilotCount: 0,
  activeCount: 0,
  runsLast24h: 0,
  costLast24hUsd: 0,
}

/**
 * Aggregate copilot health per project — one pass over the registry.
 * `projectId: null` = bench copilot (not yet validated) → excluded.
 */
function rollupByProject(copilots: Copilot[]): Map<string, ProjectRollup> {
  const byProject = new Map<string, ProjectRollup>()
  for (const copilot of copilots) {
    if (copilot.projectId === null) continue
    const current = byProject.get(copilot.projectId) ?? { ...EMPTY_ROLLUP }
    current.copilotCount += 1
    if (copilot.status === 'active') current.activeCount += 1
    current.runsLast24h += copilot.health.runsLast24h
    current.costLast24hUsd += copilot.health.costLast24hUsd
    byProject.set(copilot.projectId, current)
  }
  return byProject
}

function ProjectsCard({
  projects,
  rollups,
}: {
  projects: Project[]
  rollups: Map<string, ProjectRollup>
}) {
  const shown = projects.slice(0, 5)

  return (
    <AgentSectionCard
      title="Projects"
      description="Product surfaces with validated agents."
      actions={<ViewAllLink href="/admin/projects" srSuffix="projects" />}
      contentClassName={shown.length > 0 ? 'px-6 py-2' : undefined}
    >
      {shown.length > 0 ? (
        <div role="list" className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {shown.map((project) => {
            const rollup = rollups.get(project.id) ?? EMPTY_ROLLUP
            return (
              <div role="listitem" key={project.id} className="flex items-center gap-4 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/admin/projects/${project.id}`}
                    title={project.name}
                    className="block truncate text-sm font-medium text-zinc-950 hover:underline dark:text-white"
                  >
                    {project.name}
                  </Link>
                  <div className="mt-0.5 truncate font-mono text-xs text-zinc-500">{project.slug}</div>
                </div>
                <div className="flex w-40 shrink-0 items-baseline justify-end gap-4 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                  <span>
                    {rollup.activeCount}/{rollup.copilotCount} active
                  </span>
                  <span>
                    {rollup.runsLast24h > 0 ? (
                      formatUsd(rollup.costLast24hUsd)
                    ) : (
                      <EmDash srLabel="No runs in the last 24 hours" />
                    )}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <CardEmptyState
          icon={FolderIcon}
          title="No projects yet"
          hint="Projects appear here as soon as a copilot is registered against a product surface."
        />
      )}
    </AgentSectionCard>
  )
}

// ---------------------------------------------------------------------------
// Attention — copilots carrying open warnings. Text + a single count Badge.
// ---------------------------------------------------------------------------

function AttentionCard({ copilots }: { copilots: Copilot[] }) {
  const flagged = copilots
    .filter((copilot) => copilot.health.openWarnings > 0)
    .sort((a, b) => b.health.openWarnings - a.health.openWarnings)
    .slice(0, 6)

  return (
    <AgentSectionCard
      title="Needs attention"
      description="Copilots carrying open warnings."
      actions={<ViewAllLink href="/admin/agents" srSuffix="copilots and warnings" />}
      contentClassName={flagged.length > 0 ? 'px-6 py-2' : undefined}
    >
      {flagged.length > 0 ? (
        <div role="list" className="divide-y divide-zinc-950/5 dark:divide-white/5">
          {flagged.map((copilot) => (
            <div role="listitem" key={copilot.id} className="flex items-center gap-4 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/admin/agents/${copilot.id}`}
                  title={copilot.name}
                  className="block truncate text-sm font-medium text-zinc-950 hover:underline dark:text-white"
                >
                  {copilot.name}
                </Link>
                <div className="mt-0.5 truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {statusLabel(copilot.status)}
                </div>
              </div>
              <Badge color="accentStrong" className="shrink-0">
                {numberFormat.format(copilot.health.openWarnings)}
                <span className="sr-only">
                  {' '}
                  open warning{copilot.health.openWarnings === 1 ? '' : 's'}
                </span>
              </Badge>
              <Link
                href={`/admin/agents/${copilot.id}`}
                className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
              >
                Investigate
                <span className="sr-only"> {copilot.name} warnings</span>
              </Link>
            </div>
          ))}
        </div>
      ) : (
        <CardEmptyState
          icon={ShieldCheckIcon}
          title="No open warnings"
          hint="All copilots are healthy. Warnings surface here the moment one is raised."
        />
      )}
    </AgentSectionCard>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DashboardPage() {
  const [copilots, projects, kpis, runs] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRegistryKpis(),
    getRecentRuns(30),
  ])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))
  const rollups = rollupByProject(copilots)

  return (
    <div className="space-y-8">
      {/* Header uniforme sur les 5 pages /admin (directive Adrien 2026-07-11). */}
      <AgentPageHeader title="Dashboard" description="Fleet health across every copilot and project." className="mt-2" />

      {/* KPI : chiffres nus, aucun graphique (directive Adrien 2026-07-11). */}
      <AgentKpiBand
        stats={[
          {
            name: 'Active copilots',
            value: String(kpis.activeCopilots),
            hint: `of ${kpis.totalCopilots}`,
          },
          {
            name: 'Runs 24h',
            value: kpis.runsLast24h.toLocaleString('en-US'),
            hint: 'across the fleet',
          },
          {
            name: 'Cost 24h',
            value: kpis.runsLast24h > 0 ? formatUsd(kpis.totalCostLast24hUsd) : '—',
            hint: kpis.runsLast24h > 0 ? 'run spend' : 'No runs in the last 24 hours',
          },
          {
            name: 'Warnings',
            value: String(kpis.openWarnings),
            hint: `${kpis.openWarnings} open warning${kpis.openWarnings === 1 ? '' : 's'}`,
          },
        ]}
      />

      <ProjectsCard projects={projects} rollups={rollups} />

      {/* Listes sobres, densités comparables — zéro meter, zéro gauge. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <FleetCard copilots={copilots} />
        <AttentionCard copilots={copilots} />
      </div>

      {/* Un seul visuel dominant : Run activity en pleine largeur, en bas. */}
      <RunActivityCard runs={runs} copilotNameById={copilotNameById} />
    </div>
  )
}
