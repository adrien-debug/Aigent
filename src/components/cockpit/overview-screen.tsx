/**
 * Aperçu — scène dominante + second rang dans la même grammaire que Runtime.
 *
 * `aig-stage` + `aig-inset` : le creux graphite porte toute la donnée ; Catalyst
 * ne sert qu'au chrome (liens, table). Pastilles via `SeverityChip`.
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Link } from '@/components/ui/link'
import { SeverityChip, SurfaceSection, type SeverityTone } from '@/components/surface-primitives'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import type { HourlyBucket } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { NamedRun, ProjectCard } from '@/lib/cockpit/named-runs'
import ActivityGraph from './activity-graph'
import { StatusLegend } from './charts'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import { Unavailable, initialsOf } from './primitives'

const ENTRY = navEntry('/')

function renderActivityPanel(buckets: HourlyBucket[] | null): ReactNode {
  if (buckets === null) {
    return (
      <Unavailable
        reason="unread"
        detail="La fenêtre de runs n'a pas pu être lue — aucune courbe n'est tracée."
      />
    )
  }
  if (buckets.every((bucket) => bucket.total === 0)) {
    return (
      <Unavailable
        reason="no-data"
        detail="Aucun run sur les dernières 24 heures. La fenêtre a bien été lue — une courbe à plat se lirait comme une activité régulière."
      />
    )
  }
  return <ActivityGraph buckets={buckets} />
}

function renderRunStreamPanel(runs: NamedRun[] | null, nowMs: number): ReactNode {
  if (runs === null) {
    return <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (runs.length === 0) {
    return <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
}

function ProjectList({ cards }: Readonly<{ cards: ProjectCard[] }>) {
  return (
    <ul className="min-w-0">
      {cards.map((card) => {
        const empty = card.copilotCount === 0
        return (
          <li key={card.id} className="aig-line-soft border-b last:border-b-0">
            <Link
              href={`/projects/${card.id}`}
              className="flex items-center gap-2 px-1 py-2 no-underline hover:bg-(--aig-line-soft) focus-visible:bg-(--aig-line-soft) focus-visible:outline-hidden"
            >
              <span className="aig-text-faint w-6 shrink-0 text-2xs font-medium tabular-nums">
                {initialsOf(card.name)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="aig-text block truncate text-sm font-medium">{card.name}</span>
                <span className="aig-text-faint block truncate text-2xs">
                  {card.repoFullName ?? 'aucun dépôt lié'}
                </span>
              </span>
              <span className="aig-text shrink-0 text-right text-2xs tabular-nums">
                {empty ? <span className="aig-text-faint">—</span> : `${card.activeCount}/${card.copilotCount}`}
              </span>
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
    <Link
      href={href}
      className="aig-accent text-2xs font-medium no-underline transition hover:opacity-80"
    >
      {label}
    </Link>
  )
}

export default function CockpitOverview({
  overview,
  nowMs,
}: Readonly<{
  overview: DashboardOverview
  nowMs: number
}>) {
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const unread = overview.windowRuns === null

  const projectCards: ProjectCard[] = overview.projects.map((p) => ({
    id: p.id,
    name: p.name,
    repoFullName: p.repoFullName,
    copilotCount: p.copilotCount,
    activeCount: p.activeCount,
    runs24h: p.runsLast24h,
    costLast24hUsd: p.costLast24hUsd,
    passRate: p.passRate,
  }))

  return (
    <>
      <PageHeader
        eyebrow="Plan de contrôle"
        title={ENTRY.name}
        description={ENTRY.purpose}
        actions={
          <>
            <Link
              href="/runs"
              className="aig-text-muted inline-flex items-center justify-center px-3 py-2 text-sm font-semibold no-underline transition hover:text-(--aig-accent)"
            >
              Voir les runs
            </Link>
            <Link
              href="/actions"
              className="aig-accent inline-flex items-center justify-center px-3 py-2 text-sm font-semibold no-underline transition hover:opacity-80"
            >
              File d’action
            </Link>
          </>
        }
      />

      <PageBody className="gap-4">
        <section className="aig-stage aig-accent-edge flex min-w-0 flex-col p-4 sm:p-5">
          <header className="pb-3">
            <p className="aig-text-faint text-3xs font-medium uppercase tracking-[0.2em]">
              Fenêtre 24 heures
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-2">
              <h2 className="aig-display text-base font-semibold">Activité de la flotte</h2>
              {slices ? (
                <div className="ml-auto min-w-0">
                  <StatusLegend slices={slices} />
                </div>
              ) : (
                <p className="aig-text-faint ml-auto text-2xs">fenêtre non lue</p>
              )}
            </div>
          </header>

          <div className="aig-hairline" />

          <div className="aig-inset mt-3 flex min-w-0 flex-col p-3">
            <div className="min-w-0">{renderActivityPanel(buckets)}</div>
            <div className="mt-3 border-t border-(--aig-line-soft) pt-3">
              <KpiStrip kpis={overview.kpis} unread={unread} />
            </div>
          </div>
        </section>

        <section className="aig-stage aig-accent-edge flex min-w-0 flex-col p-4 sm:p-5">
          <div className="aig-inset flex min-w-0 flex-col p-3">
            <div className="grid min-w-0 grid-cols-1 gap-5 xl:grid-cols-[6fr_4fr]">
              <SurfaceSection
                title="Flux d'exécution"
                hint={runs ? `${runs.length} sur la fenêtre` : undefined}
                actions={sectionLink('/runs', 'Tous les runs →')}
              >
                {renderRunStreamPanel(runs, nowMs)}
              </SurfaceSection>

              <div className="flex min-w-0 flex-col xl:border-l xl:border-(--aig-line-soft) xl:pl-4">
                <SurfaceSection
                  title="Projets"
                  hint={`${projectCards.length} au catalogue`}
                  actions={sectionLink('/projects', 'Catalogue →')}
                >
                  {projectCards.length === 0 ? (
                    <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
                  ) : (
                    <ProjectList cards={projectCards} />
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
                            <p className="aig-display truncate text-sm">{item.title}</p>
                            <p className="aig-text-muted truncate text-xs">{item.meta}</p>
                          </div>
                          <Link
                            href={item.href}
                            className="aig-accent shrink-0 text-2xs no-underline transition hover:opacity-80"
                          >
                            Ouvrir →
                          </Link>
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
