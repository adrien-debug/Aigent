import './overview.css'

import clsx from 'clsx'

import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { SeverityChip, type SeverityTone } from '@/components/surface-primitives'
import type { DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import ActivityGraph from './activity-graph'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import { OverviewSection } from './section'
import { StatusLegend } from './status-legend'

const ENTRY = navEntry('/')

function hasActivity(buckets: HourlyBucket[] | null): boolean {
  return buckets !== null && buckets.some((bucket) => bucket.total > 0)
}

function ActivityPanel({ buckets }: Readonly<{ buckets: HourlyBucket[] | null }>) {
  if (buckets === null) {
    return (
      <Unavailable reason="unread" detail="La courbe d'activité n'a pas pu être lue sur la fenêtre." />
    )
  }
  if (!hasActivity(buckets)) return null
  return <ActivityGraph buckets={buckets} />
}

function FluxAbsentLine() {
  return (
    <p className="aig-text-faint flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
      <span>Aucun run sur les dernières 24 h — fenêtre lue.</span>
      <Link href="/runs" className="overview-link shrink-0 no-underline">
        Historique complet →
      </Link>
    </p>
  )
}

function RunStreamPanel({
  runs,
  nowMs,
}: Readonly<{ runs: NamedRun[] | null; nowMs: number }>) {
  if (runs === null) {
    return <Unavailable reason="unread" detail="Le flux de runs n'a pas pu être lu." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
}

function ProjectList({ projects }: Readonly<{ projects: ProjectOverviewItem[] }>) {
  const sorted = [...projects].toSorted((a, b) => {
    const aScore = a.copilotCount > 0 ? 1 : 0
    const bScore = b.copilotCount > 0 ? 1 : 0
    if (aScore !== bScore) return bScore - aScore
    return a.name.localeCompare(b.name, 'fr')
  })

  return (
    <ul className="min-w-0">
      {sorted.map((project) => {
        const empty = project.copilotCount === 0
        return (
          <li key={project.id} className="aig-line-soft border-b last:border-b-0">
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
                  {empty
                    ? 'aucun agent'
                    : (project.repoFullName ?? 'aucun dépôt lié')}
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
      })}
    </ul>
  )
}

function ProjectsBlock({ overview }: Readonly<{ overview: DashboardOverview }>) {
  return (
    <OverviewSection
      title="Projets"
      hint={`${overview.projects.length} au catalogue`}
      actions={sectionLink('/projects', 'Catalogue →')}
    >
      {overview.projects.length === 0 ? (
        <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
      ) : (
        <ProjectList projects={overview.projects} />
      )}
    </OverviewSection>
  )
}

function EventsBlock({ overview }: Readonly<{ overview: DashboardOverview }>) {
  return (
    <OverviewSection
      title="Événements importants"
      hint={`${overview.actionItems.length} signal(aux)`}
      actions={sectionLink('/actions', 'File complète →')}
    >
      {overview.actionItems.length === 0 ? (
        <p className="aig-text-faint text-xs">
          Aucun signal bloquant sur la fenêtre actuelle — lecture réussie.
        </p>
      ) : (
        <ul className="min-w-0">
          {overview.actionItems.slice(0, 6).map((item) => (
            <li key={item.id} className="aig-line-soft flex items-start gap-3 border-b py-3 last:border-b-0">
              <SeverityChip tone={actionTone(item.status)}>{item.status}</SeverityChip>
              <div className="min-w-0 flex-1">
                <p className="aig-text truncate text-sm font-medium">{item.title}</p>
                <p className="aig-text-muted truncate text-xs">{item.meta}</p>
              </div>
              <Button plain href={item.href} className="overview-link px-2! py-1! text-2xs">
                Ouvrir →
              </Button>
            </li>
          ))}
        </ul>
      )}
    </OverviewSection>
  )
}

function actionTone(status: string): SeverityTone {
  if (status === 'blocked' || status === 'failed') return 'bad'
  if (status === 'ready_for_manual_test' || status === 'awaiting_approval') return 'warn'
  if (status === 'completed' || status === 'merged_validated') return 'good'
  return 'neutral'
}

function sectionLink(href: string, label: string) {
  return (
    <Button plain href={href} className="overview-link px-2! py-1! text-2xs">
      {label}
    </Button>
  )
}

export default function CockpitOverview({
  overview,
  nowMs,
}: Readonly<{ overview: DashboardOverview; nowMs: number }>) {
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const unread = overview.windowRuns === null
  const hasRuns = runs !== null && runs.length > 0
  const windowEmpty = !unread && overview.kpis.runs24h === 0
  const showActivity = hasActivity(buckets)

  return (
    <>
      <PageHeader
        eyebrow="Plan de contrôle"
        title={ENTRY.name}
        description={ENTRY.purpose}
        actions={
          <>
            <Button plain href="/runs">
              Voir les runs
            </Button>
            <Button href="/actions" className="overview-btn-accent">
              File d’action
            </Button>
          </>
        }
      />

      <PageBody>
        <section
          className={clsx(
            'aig-stage aig-accent-edge flex min-w-0 flex-col px-4 py-5 sm:px-6 sm:py-6',
            showActivity ? 'gap-8' : 'gap-6',
          )}
          aria-label={ENTRY.name}
        >
          <div className="overview-zone">
            <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-end lg:justify-between lg:gap-6">
              <p className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
                Fenêtre 24 heures
                {unread ? ' · non lue' : windowEmpty ? ' · lue, vide' : null}
              </p>
              {slices ? <StatusLegend slices={slices} /> : null}
            </div>

            <KpiStrip kpis={overview.kpis} unread={unread} />

            {showActivity ? (
              <>
                <div className="aig-hairline" />
                <ActivityPanel buckets={buckets} />
              </>
            ) : windowEmpty ? (
              <FluxAbsentLine />
            ) : unread ? (
              <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
            ) : null}
          </div>

          <div className="aig-hairline" />

          <div className="overview-zone">
            <header className="min-w-0">
              <h2 className="aig-h2">Opérations & catalogue</h2>
              <p className="aig-text-faint mt-1 text-xs">
                {hasRuns
                  ? 'Flux récent, projets et signaux de la fenêtre courante'
                  : 'Signaux et projets — flux vide sur la fenêtre 24 h'}
              </p>
            </header>

            {hasRuns ? (
              <div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2 xl:gap-10">
                <OverviewSection
                  title="Flux d'exécution"
                  hint={`${runs.length} sur la fenêtre`}
                  actions={sectionLink('/runs', 'Tous les runs →')}
                >
                  <div className="aig-inset min-h-0 p-3 sm:p-4">
                    <RunStreamPanel runs={runs} nowMs={nowMs} />
                  </div>
                </OverviewSection>

                <div className="flex min-w-0 flex-col gap-8 xl:gap-10">
                  <ProjectsBlock overview={overview} />
                  <EventsBlock overview={overview} />
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2 md:items-start md:gap-10">
                <EventsBlock overview={overview} />
                <ProjectsBlock overview={overview} />
              </div>
            )}
          </div>
        </section>

        {overview.dataWarnings.length > 0 ? (
          <p className="aig-accent truncate px-1 font-mono text-2xs">
            {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
