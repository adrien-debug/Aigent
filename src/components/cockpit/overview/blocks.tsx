import type { ReactNode } from 'react'
import clsx from 'clsx'

import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { SeverityChip } from '@/components/surface-primitives'
import type { ActionItem, DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import ActivityGraph from './activity-graph'
import { actionItemChip, sortOverviewProjects } from './model'
import RunStream from './run-stream'
import { OverviewSection } from './section'

export function hasWindowActivity(buckets: HourlyBucket[] | null): boolean {
  return buckets !== null && buckets.some((bucket) => bucket.total > 0)
}

function SectionAction({ href, children }: Readonly<{ href: string; children: ReactNode }>) {
  return (
    <Button plain href={href} className="aig-link-accent px-2! py-1! text-2xs">
      {children}
    </Button>
  )
}

export function ActivityPanel({ buckets }: Readonly<{ buckets: HourlyBucket[] | null }>) {
  if (buckets === null) {
    return (
      <Unavailable reason="unread" detail="La courbe d'activité n'a pas pu être lue sur la fenêtre." />
    )
  }
  if (!hasWindowActivity(buckets)) return null
  return <ActivityGraph buckets={buckets} />
}

export function FluxAbsentLine() {
  return (
    <p className="aig-text-faint flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
      <span>Aucun run sur les dernières 24 h — fenêtre lue.</span>
      <Link href="/runs" className="aig-link-accent shrink-0 no-underline">
        Historique complet →
      </Link>
    </p>
  )
}

function ProjectRow({ project }: Readonly<{ project: ProjectOverviewItem }>) {
  const empty = project.copilotCount === 0

  return (
    <li className="aig-line-soft border-b last:border-b-0">
      <Link
        href={`/projects/${project.id}`}
        className={clsx(
          'flex items-center gap-2.5 px-1 no-underline hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft) focus-visible:outline-hidden',
          empty ? 'py-2' : 'py-2.5',
        )}
      >
        <Avatar
          square
          initials={initialsOf(project.name)}
          className={clsx('size-8 shrink-0', empty && 'opacity-60')}
        />
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate text-sm',
              empty ? 'aig-text-faint font-normal' : 'aig-text font-medium',
            )}
          >
            {project.name}
          </span>
          <span className="aig-text-faint block truncate text-xs">
            {empty ? 'aucun agent' : (project.repoFullName ?? 'aucun dépôt lié')}
          </span>
        </span>
        <span className="aig-text-faint shrink-0 text-right text-xs tabular-nums">
          {empty ? (
            '—'
          ) : (
            <>
              <span className="aig-text font-medium tabular-nums">{project.activeCount}</span>
              <span>/{project.copilotCount}</span>
            </>
          )}
        </span>
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
    <li className="aig-line-soft flex items-start gap-3 border-b py-3 last:border-b-0">
      <SeverityChip tone={chip.tone}>{chip.label}</SeverityChip>
      <div className="min-w-0 flex-1">
        <p className="aig-text truncate text-sm font-medium">{item.title}</p>
        <p className="aig-text-muted truncate text-xs">{item.meta}</p>
      </div>
      <SectionAction href={item.href}>{item.buttonLabel} →</SectionAction>
    </li>
  )
}

export function ProjectsBlock({ overview }: Readonly<{ overview: DashboardOverview }>) {
  return (
    <OverviewSection
      title="Projets"
      hint={`${overview.projects.length} au catalogue`}
      actions={<SectionAction href="/projects">Catalogue →</SectionAction>}
    >
      {overview.projects.length === 0 ? (
        <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
      ) : (
        <div className="overview-scroll-list scroll-thin">
          <ProjectList projects={overview.projects} />
        </div>
      )}
    </OverviewSection>
  )
}

export function EventsBlock({ overview }: Readonly<{ overview: DashboardOverview }>) {
  return (
    <OverviewSection
      title="Événements importants"
      hint={`${overview.actionItems.length} signal(aux)`}
      actions={<SectionAction href="/actions">File complète →</SectionAction>}
    >
      {overview.actionItems.length === 0 ? (
        <p className="aig-text-faint text-xs">
          Aucun signal bloquant sur la fenêtre actuelle — lecture réussie.
        </p>
      ) : (
        <ul className="min-w-0">
          {overview.actionItems.slice(0, 6).map((item) => (
            <EventRow key={item.id} item={item} />
          ))}
        </ul>
      )}
    </OverviewSection>
  )
}

export function FluxBlock({
  runs,
  nowMs,
}: Readonly<{ runs: NamedRun[]; nowMs: number }>) {
  return (
    <OverviewSection
      title="Flux d'exécution"
      hint={`${runs.length} sur la fenêtre`}
      actions={<SectionAction href="/runs">Tous les runs →</SectionAction>}
    >
      <div className="aig-inset min-h-0 p-3 sm:p-4">
        <RunStream runs={runs} nowMs={nowMs} />
      </div>
    </OverviewSection>
  )
}
