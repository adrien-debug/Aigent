import clsx from 'clsx'

import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Avatar } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Link } from '@/components/ui/link'
import { Strong, Text } from '@/components/ui/text'
import { Unavailable, initialsOf } from '@/components/cockpit/primitives'
import { SeverityChip, SurfaceSection, type SeverityTone } from '@/components/surface-primitives'
import type { DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { NamedRun } from '@/lib/cockpit/named-runs'
import ActivityGraph from './activity-graph'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import { StatusLegend } from './status-legend'

const ENTRY = navEntry('/')

function ActivityPanel({ buckets }: Readonly<{ buckets: HourlyBucket[] | null }>) {
  if (buckets === null) {
    return (
      <Unavailable
        reason="unread"
        detail="La fenêtre de runs n'a pas pu être lue."
      />
    )
  }
  if (buckets.every((bucket) => bucket.total === 0)) {
    return (
      <Text className="aig-text-faint text-sm">
        Aucun run sur les dernières 24 heures — la fenêtre a bien été lue.
      </Text>
    )
  }
  return <ActivityGraph buckets={buckets} />
}

function RunStreamPanel({
  runs,
  nowMs,
}: Readonly<{ runs: NamedRun[] | null; nowMs: number }>) {
  if (runs === null) {
    return <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (runs.length === 0) {
    return <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
}

function ProjectList({ projects }: Readonly<{ projects: ProjectOverviewItem[] }>) {
  const sorted = [...projects].sort((a, b) => {
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
              className="flex items-center gap-2.5 px-1 py-2.5 no-underline hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft) focus-visible:outline-hidden"
            >
              <Avatar
                square
                initials={initialsOf(project.name)}
                className={clsx('size-8 shrink-0', empty && 'opacity-60')}
              />
              <span className="min-w-0 flex-1">
                <Strong className={clsx('block truncate', empty && 'aig-text-muted')}>
                  {project.name}
                </Strong>
                <Text className="truncate">{project.repoFullName ?? 'aucun dépôt lié'}</Text>
              </span>
              <Text className="shrink-0 text-right tabular-nums">
                {empty ? (
                  <span className="aig-text-faint text-xs">—</span>
                ) : (
                  <>
                    <Strong className="tabular-nums">{project.activeCount}</Strong>
                    <span className="aig-text-faint">/{project.copilotCount}</span>
                  </>
                )}
              </Text>
            </Link>
          </li>
        )
      })}
    </ul>
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
    <Button plain href={href} className="px-2! py-1! text-2xs">
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
            <Button color="orange" href="/actions">
              File d’action
            </Button>
          </>
        }
      />

      <PageBody>
        <section
          className="aig-stage aig-accent-edge flex min-w-0 flex-col gap-8 px-3 py-4 sm:px-5 sm:py-5"
          aria-label={ENTRY.name}
        >
          <div className="flex min-w-0 flex-col gap-5">
            <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <Text className="aig-text-faint text-2xs font-medium uppercase tracking-[0.18em]">
                  Fenêtre 24 heures
                </Text>
                <h2 className="aig-h2 mt-1">Activité de la flotte</h2>
              </div>
              {slices ? (
                <div className="min-w-0 sm:max-w-md sm:pt-1">
                  <StatusLegend slices={slices} />
                </div>
              ) : (
                <Text className="aig-text-faint text-xs">fenêtre non lue</Text>
              )}
            </header>

            <KpiStrip kpis={overview.kpis} unread={unread} />
            <ActivityPanel buckets={buckets} />
          </div>

          <div className="aig-hairline" />

          <div className="flex min-w-0 flex-col gap-5">
            <header>
              <h2 className="aig-h2">Opérations & catalogue</h2>
              <Text className="aig-text-faint mt-1 text-xs">
                Flux récent, projets et signaux de la fenêtre courante
              </Text>
            </header>

            <div className="grid min-w-0 grid-cols-1 gap-6 xl:grid-cols-[6fr_4fr]">
              <SurfaceSection
                title="Flux d'exécution"
                hint={runs ? `${runs.length} sur la fenêtre` : undefined}
                actions={sectionLink('/runs', 'Tous les runs →')}
              >
                <RunStreamPanel runs={runs} nowMs={nowMs} />
              </SurfaceSection>

              <div className="flex min-w-0 flex-col xl:aig-line-soft xl:border-l xl:pl-5">
                <SurfaceSection
                  title="Projets"
                  hint={`${overview.projects.length} au catalogue`}
                  actions={sectionLink('/projects', 'Catalogue →')}
                >
                  {overview.projects.length === 0 ? (
                    <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
                  ) : (
                    <ProjectList projects={overview.projects} />
                  )}
                </SurfaceSection>

                <div className="aig-hairline my-4" />

                <SurfaceSection
                  title="Événements importants"
                  hint={`${overview.actionItems.length} signal(aux)`}
                  actions={sectionLink('/actions', 'File complète →')}
                >
                  {overview.actionItems.length === 0 ? (
                    <Unavailable
                      reason="no-data"
                      detail="Aucun signal bloquant sur la fenêtre actuelle. La lecture a réussi."
                    />
                  ) : (
                    <ul className="divide-y divide-(--aig-line-soft)">
                      {overview.actionItems.slice(0, 6).map((item) => (
                        <li key={item.id} className="flex items-start gap-3 py-3">
                          <SeverityChip tone={actionTone(item.status)}>{item.status}</SeverityChip>
                          <div className="min-w-0 flex-1">
                            <p className="aig-text truncate text-sm font-medium">{item.title}</p>
                            <p className="aig-text-muted truncate text-xs">{item.meta}</p>
                          </div>
                          <Button plain href={item.href} className="px-2! py-1! text-2xs">
                            Ouvrir →
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </SurfaceSection>
              </div>
            </div>
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
