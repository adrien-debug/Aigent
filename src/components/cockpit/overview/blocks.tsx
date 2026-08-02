import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { NotMeasured, Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { SeverityChip } from '@/components/surface-primitives'
import type { ActionItem, DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import ActivityGraph, { GhostActivityGraph } from './activity-graph'
import { actionItemChip, sortOverviewProjects } from './model'
import RunStream from './run-stream'
import { OverviewSection } from './section'
import { BarMeter } from './meters'

export function hasWindowActivity(buckets: HourlyBucket[] | null): boolean {
  return buckets !== null && buckets.some((bucket) => bucket.total > 0)
}

function SectionAction({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Button plain href={href} className="aig-link-accent whitespace-nowrap">
      {children}
    </Button>
  )
}

function EmptyOverviewLine({
  detail,
  href,
  action,
}: Readonly<{ detail: string; href?: string; action?: string }>) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      <NotMeasured label="—" why={detail} />
      <span className="aig-text-faint min-w-0 text-xs">{detail}</span>
      {href && action ? (
        <Link href={href} className="aig-link-accent shrink-0 whitespace-nowrap no-underline">
          {action} →
        </Link>
      ) : null}
    </div>
  )
}

function EmptyInlineMeta({ detail }: Readonly<{ detail: string }>) {
  return (
    <span className="flex min-w-0 items-baseline gap-1.5">
      <NotMeasured label="—" why={detail} />
      <span className="aig-text-faint min-w-0 truncate text-xs">{detail}</span>
    </span>
  )
}

export function ActivityPanel({ buckets }: Readonly<{ buckets: HourlyBucket[] | null }>) {
  if (buckets === null) {
    return (
      <Unavailable reason="unread" detail="La courbe d'activité n'a pas pu être lue sur la fenêtre." />
    )
  }
  if (!hasWindowActivity(buckets)) return <GhostActivityGraph />
  return <ActivityGraph buckets={buckets} />
}

export function FluxAbsentLine() {
  return <GhostActivityGraph />
}

function ProjectRow({ project }: Readonly<{ project: ProjectOverviewItem }>) {
  const empty = project.copilotCount === 0

  return (
    <li className="mb-2 last:mb-0">
      <Link
        href={`/projects/${project.id}`}
        className={clsx(
          'flex min-h-12 items-center gap-3 px-3 rounded-lg border border-transparent transition-all duration-300 no-underline hover:border-white/10 hover:bg-white/[0.02] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] focus-visible:bg-white/[0.02] focus-visible:outline-hidden',
          empty ? 'py-2' : 'py-2.5',
        )}
      >
        <div className="relative shrink-0">
          <Avatar
            square
            initials={initialsOf(project.name)}
            className={clsx('size-8', empty && 'opacity-60')}
          />
          <div className="absolute inset-0 rounded-lg shadow-[inset_0_1px_2px_rgba(255,255,255,0.1)] pointer-events-none" />
        </div>
        <div className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate text-sm',
              empty ? 'aig-text-faint font-normal' : 'aig-text font-medium',
            )}
          >
            {project.name}
          </span>
          {empty ? (
            <EmptyInlineMeta detail="Aucun agent dans ce projet." />
          ) : (
            <span className="aig-text-faint block truncate text-xs uppercase tracking-wider">
              {project.repoFullName ?? 'aucun dépôt lié'}
            </span>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end justify-center gap-1.5 w-20">
          {empty ? (
            <NotMeasured label="—" why="Aucun agent actif dans ce projet." />
          ) : (
            <>
              <div className="aig-text text-xs font-medium tabular-nums tracking-wider">
                {project.activeCount} <span className="aig-text-faint font-normal">/ {project.copilotCount}</span>
              </div>
              <BarMeter 
                ratio={project.activeCount / project.copilotCount} 
                color="var(--aig-severity-good)" 
                className="w-full h-1" 
              />
            </>
          )}
        </div>
      </Link>
    </li>
  )
}

function ProjectList({ projects }: Readonly<{ projects: readonly ProjectOverviewItem[] }>) {
  return (
    <ul className="min-w-0">
      {sortOverviewProjects(projects).map((project) => (
        <ProjectRow key={project.id} project={project} />
      ))}
    </ul>
  )
}

function EventRow({ item }: Readonly<{ item: ActionItem }>) {
  const chip = actionItemChip(item)

  return (
    <li className="mb-2 last:mb-0 flex min-h-12 items-center gap-3 py-2.5 px-3 rounded-lg border border-transparent transition-all duration-300 hover:border-white/10 hover:bg-white/[0.02] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <SeverityChip tone={chip.tone} className="shrink-0">
        {chip.label}
      </SeverityChip>
      <div className="min-w-0 flex-1">
        <p className="aig-text truncate text-sm font-medium">{item.title}</p>
        <p className="aig-text-faint truncate text-xs uppercase tracking-wider">{item.meta}</p>
      </div>
      <SectionAction href={item.href}>{item.buttonLabel} →</SectionAction>
    </li>
  )
}

export function ProjectsBlock({
  overview,
  className,
}: Readonly<{ overview: DashboardOverview; className?: string }>) {
  return (
    <OverviewSection
      className={className}
      title="Projets"
      hint={`${overview.projects.length} au catalogue`}
      actions={<SectionAction href="/projects">Catalogue →</SectionAction>}
    >
      {overview.projects.length === 0 ? (
        <div className="aig-empty-well">
          <EmptyOverviewLine detail="Aucun projet dans le catalogue." />
        </div>
      ) : (
        <div className="overview-scroll-list scroll-thin min-h-0 flex-1 -mx-3">
          <ProjectList projects={overview.projects} />
        </div>
      )}
    </OverviewSection>
  )
}

export function EventsBlock({
  overview,
  className,
}: Readonly<{ overview: DashboardOverview; className?: string }>) {
  return (
    <OverviewSection
      className={className}
      title="Événements importants"
      hint={`${overview.actionItems.length} signal(aux)`}
      actions={<SectionAction href="/actions">File complète →</SectionAction>}
    >
      {overview.actionItems.length === 0 ? (
        <div className="aig-empty-well">
          <EmptyOverviewLine detail="Aucun signal bloquant sur la fenêtre actuelle — lecture réussie." />
        </div>
      ) : (
        <div className="min-h-0 flex-1 -mx-3">
          <ul className="min-w-0">
            {overview.actionItems.slice(0, 6).map((item) => (
              <EventRow key={item.id} item={item} />
            ))}
          </ul>
        </div>
      )}
    </OverviewSection>
  )
}

export function FluxBlock({
  runs,
  nowMs,
  className,
}: Readonly<{ runs: NamedRun[]; nowMs: number; className?: string }>) {
  return (
    <OverviewSection
      className={className}
      title="Flux d'exécution"
      hint={`${runs.length} sur la fenêtre`}
      actions={<SectionAction href="/runs">Tous les runs →</SectionAction>}
    >
      <div className="aig-inset flex min-h-0 flex-1 flex-col p-3 sm:p-4">
        <RunStream runs={runs} nowMs={nowMs} />
      </div>
    </OverviewSection>
  )
}
