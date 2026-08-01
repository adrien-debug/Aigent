/**
 * Overview — instruments et rosters sur fond clair, scroll document naturel.
 *
 * Hiérarchie : bandeau KPI → activité (histogramme) → rosters (flux, projets).
 * Pas de bandeau shell : tout vit dans la zone de travail blanche.
 *
 * Server Component : l'histogramme est le seul module client (Recharts).
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { Link } from '@/components/ui/link'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { NamedRun, ProjectCard } from '@/lib/cockpit/named-runs'
import { HourlyRunsChart, StatusLegend } from './charts'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import ProjectCarousel from './project-carousel'
import { Panel, Unavailable } from './primitives'

const ENTRY = navEntry('/')

function renderRunStreamPanel(runs: NamedRun[] | null, nowMs: number): ReactNode {
  if (runs === null) {
    return <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (runs.length === 0) {
    return <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
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
  const rankedProjects = projectCards

  return (
    <div className="flex flex-col gap-4 p-6 pt-16 lg:pt-6 lg:px-8">
      {/* En-tête de page — même surface noire que les boxes, titre blanc, et
          les deux actions de l'écran à droite : la discrète en `white/10`,
          l'action principale en accent. */}
      <header className="dark rounded-lg bg-black px-6 py-5 ring-1 ring-white/10 md:flex md:items-center md:justify-between md:space-x-5">
        <div className="flex items-start space-x-5">
          <div className="shrink-0">
            <div className="relative flex size-16 items-center justify-center rounded-full bg-white/5 outline -outline-offset-1 outline-white/10">
              <svg viewBox="0 0 24 24" fill="none" aria-hidden className="size-7 text-white">
                <path
                  d="M12 2.2 21.8 12 12 21.8 2.2 12 12 2.2Z"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
                <path d="M12 7.4 16.6 12 12 16.6 7.4 12 12 7.4Z" fill="currentColor" fillOpacity="0.9" />
              </svg>
            </div>
          </div>

          {/* Le padding vertical simule un centrage quand les deux lignes
              tiennent sur une ligne, sans faire sauter la marque si le texte
              passe à la ligne. */}
          <div className="pt-1.5">
            <h1 className="text-2xl font-bold text-white">{ENTRY.name}</h1>
            <p className="text-sm font-medium text-gray-400">{ENTRY.purpose}</p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse justify-stretch space-y-4 space-y-reverse sm:flex-row-reverse sm:justify-end sm:space-y-0 sm:space-x-3 sm:space-x-reverse md:mt-0 md:flex-row md:space-x-3">
          <Link
            href="/runs"
            className="inline-flex items-center justify-center rounded-md bg-white/10 px-3 py-2 text-sm font-semibold text-white no-underline inset-ring inset-ring-white/5 hover:bg-white/20"
          >
            Voir les runs
          </Link>
          <Link
            href="/actions"
            className="inline-flex items-center justify-center rounded-md bg-indigo-500 px-3 py-2 text-sm font-semibold text-white no-underline hover:bg-indigo-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            File d’action
          </Link>
        </div>
      </header>

      <KpiStrip kpis={overview.kpis} unread={unread} />

      <Panel
        title="Activité 24 h"
        className="min-w-0"
        padded={false}
        bodyClassName="px-2 pt-3 pb-1"
        actions={slices ? <StatusLegend slices={slices} /> : undefined}
        hint={slices ? undefined : 'fenêtre non lue'}
      >
        {buckets ? (
          <HourlyRunsChart buckets={buckets} />
        ) : (
          <Unavailable
            reason="unread"
            detail="La fenêtre de runs n'a pas pu être lue — aucune courbe n'est tracée."
          />
        )}
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.35fr_1fr]">
        <Panel
          title="Flux d'exécution"
          hint={runs ? `${runs.length} sur la fenêtre` : undefined}
          className="min-w-0"
          padded={false}
        >
          {renderRunStreamPanel(runs, nowMs)}
        </Panel>

        <Panel
          title="Projets"
          hint={`${projectCards.length} au catalogue`}
          className="min-w-0"
          padded={false}
        >
          {projectCards.length === 0 ? (
            <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
          ) : (
            <ProjectCarousel cards={rankedProjects} />
          )}
        </Panel>
      </div>

      {overview.dataWarnings.length > 0 ? (
        <p className="truncate rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-2xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/8 dark:text-amber-400">
          {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
        </p>
      ) : null}
    </div>
  )
}
