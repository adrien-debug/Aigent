import { BoltIcon, CpuChipIcon, FolderIcon, ShieldCheckIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { SplitBar, type SplitSegment, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import {
  getCopilots,
  getProjects,
  getRecentRuns,
  getRecentWarnings,
  getRegistryKpis,
} from '@/lib/agent-mission-control/data'
import { formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
import type { AgentRun, Copilot, CopilotStatus, Project, RegistryWarning } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Dashboard — Agent Mission Control',
}

const numberFormat = new Intl.NumberFormat('en-US')

/** Status enum → plain human label (no badge, no colour): "needs-confirmation" → "Needs confirmation". */
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

/** Card-footer affordance shared by every bento cell — same slot, same style. */
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

/** Shared empty-state rhythm (icon + label + hint), identical across bento cells. */
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
// Series builders — deterministic, plain data (server side, no chart lib)
// ---------------------------------------------------------------------------

/**
 * Doctrine mapping: healthy/active = soft accent, attention (degraded) =
 * stronger intensity, lifecycle-neutral states (paused/draft/archived) = zinc.
 * The label always carries the meaning — colour is never the sole signal.
 */
const STATUS_SEGMENTS: { status: CopilotStatus; tone: SplitTone }[] = [
  { status: 'active', tone: 'accent-500' },
  { status: 'degraded', tone: 'accent-700' },
  { status: 'paused', tone: 'zinc' },
  { status: 'draft', tone: 'zinc' },
  { status: 'archived', tone: 'zinc' },
]

function buildStatusSegments(copilots: Copilot[]): SplitSegment[] {
  return STATUS_SEGMENTS.map(({ status, tone }) => ({
    key: status,
    label: statusLabel(status),
    value: copilots.filter((copilot) => copilot.status === status).length,
    tone,
  })).filter((segment) => segment.value > 0)
}

interface RunSeries {
  /** Bucket granularity actually used — hourly when the window spans < 3 days. */
  unit: 'day' | 'hour'
  /** Run count per bucket, oldest → newest. */
  counts: number[]
  /** Running total of run cost per bucket, oldest → newest. */
  cumulativeCostUsd: number[]
}

/** Group recent runs into chronological buckets (by day, or by hour when the window is short). */
function buildRunSeries(runs: AgentRun[]): RunSeries {
  const bucket = (keyLength: number) => {
    const map = new Map<string, { count: number; costUsd: number }>()
    for (const run of runs) {
      const key = run.startedAt.slice(0, keyLength)
      const current = map.get(key) ?? { count: 0, costUsd: 0 }
      current.count += 1
      current.costUsd += run.costUsd
      map.set(key, current)
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b))
  }

  // "YYYY-MM-DD" = 10 chars; "YYYY-MM-DDTHH" = 13 chars.
  let unit: RunSeries['unit'] = 'day'
  let entries = bucket(10)
  if (entries.length < 3) {
    unit = 'hour'
    entries = bucket(13)
  }

  let running = 0
  return {
    unit,
    counts: entries.map(([, v]) => v.count),
    cumulativeCostUsd: entries.map(([, v]) => (running += v.costUsd)),
  }
}

/** Warning severity mix — magnitude by intensity in the single accent ramp. */
function buildSeveritySegments(warnings: RegistryWarning[]): SplitSegment[] {
  const dangers = warnings.filter((warning) => warning.severity === 'danger').length
  return [
    { key: 'warning', label: 'Warning', value: warnings.length - dangers, tone: 'accent-500' as const },
    { key: 'danger', label: 'Danger', value: dangers, tone: 'accent-700' as const },
  ].filter((segment) => segment.value > 0)
}

// ---------------------------------------------------------------------------
// Fleet health — status mix SplitBar + one meter row per status (fills the card)
// ---------------------------------------------------------------------------

const STATUS_METER_TONE: Record<CopilotStatus, 'accent' | 'accentStrong' | 'zinc'> = {
  active: 'accent',
  degraded: 'accentStrong',
  paused: 'zinc',
  draft: 'zinc',
  archived: 'zinc',
}

function FleetHealthCard({ copilots }: { copilots: Copilot[] }) {
  const segments = buildStatusSegments(copilots)
  const degraded = copilots.filter((copilot) => copilot.status === 'degraded').slice(0, 4)
  const total = copilots.length

  return (
    <AgentSectionCard
      title="Fleet health"
      description="Status mix across the whole fleet."
      actions={<ViewAllLink href="/admin/agents" srSuffix="copilots" />}
    >
      {copilots.length > 0 ? (
        <div className="space-y-6">
          {/* The per-status meter rows below are the legend — the bar stays label-free. */}
          <SplitBar segments={segments} height="md" showLegend={false} />

          <div role="list">
            {STATUS_SEGMENTS.map(({ status }) => {
              const count = copilots.filter((copilot) => copilot.status === status).length
              return (
                <div role="listitem" key={status} className="flex items-center gap-3 py-2">
                  <span className="w-20 shrink-0 text-xs text-zinc-500">{statusLabel(status)}</span>
                  <div className="min-w-0 flex-1">
                    <LinearMeter
                      size="xs"
                      value={count}
                      max={total}
                      tone={STATUS_METER_TONE[status]}
                      ariaLabel={`${statusLabel(status)} copilots: ${count} of ${total}`}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono text-xs text-zinc-700 tabular-nums dark:text-zinc-300">
                    {count}
                  </span>
                </div>
              )
            })}
          </div>

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
// Recent activity — latency chart over the run window + dense flush table
// ---------------------------------------------------------------------------

const ACTIVITY_TABLE_ROWS = 5

function RecentActivityCard({
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
      title="Recent activity"
      description="Latest runs across every copilot."
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
// Projects — mini-list with per-project rollup + active/total meter
// ---------------------------------------------------------------------------

interface ProjectRollup {
  copilotCount: number
  activeCount: number
  runsLast24h: number
  costLast24hUsd: number
  openWarnings: number
}

const EMPTY_ROLLUP: ProjectRollup = {
  copilotCount: 0,
  activeCount: 0,
  runsLast24h: 0,
  costLast24hUsd: 0,
  openWarnings: 0,
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
    current.openWarnings += copilot.health.openWarnings
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
              // Colonnes identiques sur chaque ligne (flex-1 / flex-1 / w-36) → alignement au pixel.
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
                <div className="hidden min-w-0 flex-1 sm:block">
                  <LinearMeter
                    size="xs"
                    value={rollup.activeCount}
                    max={rollup.copilotCount}
                    tone="accent"
                    ariaLabel={`${project.name}: ${rollup.activeCount} of ${rollup.copilotCount} copilots active`}
                  />
                </div>
                <div className="flex w-36 shrink-0 items-baseline justify-end gap-3 font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
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
// Attention — copilots carrying open warnings, meter scaled to the worst one
// ---------------------------------------------------------------------------

function AttentionCard({ copilots }: { copilots: Copilot[] }) {
  const flagged = copilots
    .filter((copilot) => copilot.health.openWarnings > 0)
    .sort((a, b) => b.health.openWarnings - a.health.openWarnings)
    .slice(0, 5)
  // Meters read against the worst copilot in the list — intensity escalates with volume.
  const maxWarnings = flagged.reduce((max, copilot) => Math.max(max, copilot.health.openWarnings), 1)

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
              <div className="hidden min-w-0 flex-1 sm:block">
                <LinearMeter
                  size="xs"
                  value={copilot.health.openWarnings}
                  max={maxWarnings}
                  tone={copilot.health.openWarnings === maxWarnings ? 'accentSolid' : 'accentStrong'}
                  ariaLabel={`${copilot.name}: ${copilot.health.openWarnings} open warnings out of ${maxWarnings} for the worst copilot`}
                />
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
  const [copilots, projects, kpis, runs, warnings] = await Promise.all([
    getCopilots(),
    getProjects(),
    getRegistryKpis(),
    getRecentRuns(30),
    getRecentWarnings(50),
  ])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))
  const rollups = rollupByProject(copilots)

  const statusSegments = buildStatusSegments(copilots)
  const runSeries = buildRunSeries(runs)
  const severitySegments = buildSeveritySegments(warnings)
  const trendHint = `Per-${runSeries.unit} trend, last ${runs.length} runs`

  return (
    <div className="space-y-8">
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          {
            name: 'Active copilots',
            value: String(kpis.activeCopilots),
            viz:
              statusSegments.length > 0 ? (
                <SplitBar segments={statusSegments} showLegend={false} />
              ) : undefined,
            hint: `of ${kpis.totalCopilots}`,
          },
          {
            name: 'Runs 24h',
            value: kpis.runsLast24h.toLocaleString('en-US'),
            viz:
              runs.length > 0 ? (
                <Sparkline
                  kind="bar"
                  points={runSeries.counts}
                  width={96}
                  height={24}
                  ariaLabel={`Run volume per ${runSeries.unit}, oldest to newest`}
                />
              ) : undefined,
            hint: runs.length > 0 ? trendHint : undefined,
          },
          {
            name: 'Cost 24h',
            value: kpis.runsLast24h > 0 ? formatUsd(kpis.totalCostLast24hUsd) : '—',
            viz:
              runs.length > 0 ? (
                <Sparkline
                  points={runSeries.cumulativeCostUsd}
                  width={96}
                  height={24}
                  ariaLabel={`Cumulative run cost per ${runSeries.unit}, oldest to newest`}
                />
              ) : undefined,
            hint: kpis.runsLast24h > 0 ? trendHint : 'No runs in the last 24 hours',
          },
          {
            name: 'Warnings',
            value: String(kpis.openWarnings),
            viz:
              kpis.openWarnings > 0 && severitySegments.length > 0 ? (
                <SplitBar segments={severitySegments} showLegend={false} />
              ) : kpis.openWarnings > 0 ? (
                <LinearMeter
                  size="xs"
                  value={kpis.openWarnings}
                  max={Math.max(kpis.openWarnings, kpis.totalCopilots)}
                  tone="accentStrong"
                  ariaLabel={`${kpis.openWarnings} open warnings across ${kpis.totalCopilots} copilots`}
                />
              ) : undefined,
            hint: `${kpis.openWarnings} open warning${kpis.openWarnings === 1 ? '' : 's'}`,
          },
        ]}
      />

      {/* Bento — 2×2, chaque cellule gère son empty state, densités comparables par rangée. */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <FleetHealthCard copilots={copilots} />
        <RecentActivityCard runs={runs} copilotNameById={copilotNameById} />
        <ProjectsCard projects={projects} rollups={rollups} />
        <AttentionCard copilots={copilots} />
      </div>
    </div>
  )
}
