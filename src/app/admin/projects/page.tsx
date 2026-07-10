import { FolderIcon } from '@heroicons/react/24/outline'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { LinearMeter } from '@/components/agent-ops/widgets/linear-meter'
import { RadialMeter } from '@/components/agent-ops/widgets/radial-meter'
import { Sparkline } from '@/components/agent-ops/widgets/sparkline'
import { SplitBar, type SplitSegment, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import { Badge } from '@/components/catalyst/badge'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import { formatUsd } from '@/lib/agent-mission-control/format'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

export const metadata: Metadata = {
  title: 'Projects — Agent Mission Control',
}

const PLATFORM_LABELS: Record<Project['platform'], string> = {
  web: 'Web',
  desktop: 'Desktop',
  mobile: 'Mobile',
  api: 'API',
}

const numberFormat = new Intl.NumberFormat('en-US')

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
 * `projectId: null` = bench copilot (not yet validated) → excluded from
 * per-project counts.
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

/**
 * Platform mix as one accent-ramp SplitBar (severity/magnitude by INTENSITY,
 * never a second hue): biggest bucket = brightest accent, tail bucket = zinc.
 * Deterministic order (by count desc). Fills the KPI `viz` slot.
 */
function platformMixSegments(projects: Project[]): SplitSegment[] {
  const counts: Record<Project['platform'], number> = { web: 0, desktop: 0, mobile: 0, api: 0 }
  for (const project of projects) counts[project.platform] += 1

  const ramp: SplitTone[] = ['accent-500', 'accent-600', 'accent-700']
  const present = (Object.keys(counts) as Project['platform'][])
    .filter((platform) => counts[platform] > 0)
    .sort((a, b) => counts[b] - counts[a])

  return present.map((platform, index) => ({
    key: platform,
    label: PLATFORM_LABELS[platform],
    value: counts[platform],
    tone:
      present.length > 1 && index === present.length - 1
        ? 'zinc'
        : ramp[Math.min(index, ramp.length - 1)],
  }))
}

export default async function ProjectsPage() {
  const [projects, copilots] = await Promise.all([getProjects(), getCopilots()])
  const rollups = rollupByProject(copilots)

  // Bench copilots (projectId null) are excluded — this page counts validated agents only.
  const validated = copilots.filter((copilot) => copilot.projectId !== null)
  const totalActive = validated.filter((copilot) => copilot.status === 'active').length
  const totalRuns = validated.reduce((sum, copilot) => sum + copilot.health.runsLast24h, 0)
  const totalCost = validated.reduce((sum, copilot) => sum + copilot.health.costLast24hUsd, 0)

  // Per-project series in a stable order — traffic/spend concentration at a glance.
  const runsSeries = projects.map((project) => (rollups.get(project.id) ?? EMPTY_ROLLUP).runsLast24h)
  const costSeries = projects.map((project) => (rollups.get(project.id) ?? EMPTY_ROLLUP).costLast24hUsd)
  const maxRuns = Math.max(1, ...runsSeries)
  const maxCost = Math.max(1, ...costSeries)

  return (
    <div className="space-y-8">
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          {
            name: 'Projects',
            value: String(projects.length),
            viz: projects.length > 0 ? <SplitBar segments={platformMixSegments(projects)} /> : undefined,
          },
          {
            name: 'Copilots',
            value: String(validated.length),
            hint: 'validated — excl. bench',
            viz: (
              <RadialMeter
                value={totalActive}
                max={Math.max(validated.length, 1)}
                size={64}
                strokeWidth={5}
                caption={`of ${validated.length}`}
                ariaLabel={`${totalActive} of ${validated.length} validated copilots active`}
              />
            ),
          },
          {
            name: 'Runs 24h',
            value: totalRuns.toLocaleString('en-US'),
            viz:
              projects.length > 0 ? (
                <Sparkline
                  points={runsSeries}
                  kind="bar"
                  tone="accent"
                  width={112}
                  height={28}
                  ariaLabel="Runs in the last 24h, per project"
                />
              ) : undefined,
          },
          {
            name: 'Cost 24h',
            value: formatUsd(totalCost),
            viz:
              projects.length > 0 ? (
                <Sparkline
                  points={costSeries}
                  kind="bar"
                  tone="accent"
                  width={112}
                  height={28}
                  ariaLabel="Cost in the last 24h, per project"
                />
              ) : undefined,
          },
        ]}
      />

      <AgentSectionCard
        title="Projects"
        actions={<span className="text-xs text-zinc-500 tabular-nums">{projects.length}</span>}
        contentClassName="p-0"
      >
        {projects.length > 0 ? (
          <div className="px-6 [--gutter:--spacing(6)]">
            <Table bleed>
              {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
              <caption className="sr-only">Projects</caption>
              <TableHead>
                <TableRow>
                  <TableHeader>Project</TableHeader>
                  <TableHeader>Fleet</TableHeader>
                  <TableHeader>Runs 24h</TableHeader>
                  <TableHeader>Cost 24h</TableHeader>
                  <TableHeader className="text-right">Warnings</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {projects.map((project) => {
                  const rollup = rollups.get(project.id) ?? EMPTY_ROLLUP
                  return (
                    <TableRow key={project.id}>
                      <TableCell>
                        <div className="min-w-0">
                          <div className="truncate font-medium text-zinc-950 dark:text-white">
                            <Link
                              href={`/admin/projects/${project.id}`}
                              title={project.name}
                              className="hover:underline"
                            >
                              {project.name}
                            </Link>
                          </div>
                          <div className="mt-1 truncate font-mono text-xs text-zinc-500">
                            {project.slug} · {PLATFORM_LABELS[project.platform]}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="w-28">
                          <LinearMeter
                            value={rollup.activeCount}
                            max={Math.max(rollup.copilotCount, 1)}
                            size="xs"
                            valueText={`${rollup.activeCount}/${rollup.copilotCount}`}
                            ariaLabel={`${rollup.activeCount} of ${rollup.copilotCount} copilots active on ${project.name}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="w-24">
                          <LinearMeter
                            value={rollup.runsLast24h}
                            max={maxRuns}
                            size="xs"
                            valueText={numberFormat.format(rollup.runsLast24h)}
                            ariaLabel={`${rollup.runsLast24h} runs in the last 24h on ${project.name}`}
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="w-24">
                          {rollup.runsLast24h > 0 ? (
                            <LinearMeter
                              value={rollup.costLast24hUsd}
                              max={maxCost}
                              size="xs"
                              valueText={formatUsd(rollup.costLast24hUsd)}
                              ariaLabel={`${formatUsd(rollup.costLast24hUsd)} spent in the last 24h on ${project.name}`}
                            />
                          ) : (
                            <div className="text-right font-mono text-zinc-500 tabular-nums">
                              <span aria-hidden="true">&mdash;</span>
                              <span className="sr-only">No runs in the last 24 hours</span>
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {rollup.openWarnings > 0 ? (
                          <Badge color="accentStrong" className="font-mono tabular-nums">
                            {numberFormat.format(rollup.openWarnings)}
                            <span className="sr-only"> open warnings</span>
                          </Badge>
                        ) : (
                          <span className="font-mono text-zinc-500 tabular-nums">0</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <FolderIcon aria-hidden="true" className="size-8 text-zinc-400 dark:text-zinc-600" />
            <p className="text-sm font-medium text-zinc-950 dark:text-white">No projects yet</p>
            <p className="max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
              Projects appear here as soon as a copilot is registered against a product surface.
            </p>
          </div>
        )}
      </AgentSectionCard>
    </div>
  )
}
