import './overview.css'

import clsx from 'clsx'

import { navEntry } from '@/components/navigation'
import { PageBody, PageHeader } from '@/components/app-shell'
import { Button } from '@/components/ui/button'
import { Unavailable } from '@/components/cockpit/primitives'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildNamedRuns } from '@/lib/cockpit/named-runs'
import {
  ActivityPanel,
  EventsBlock,
  FluxAbsentLine,
  FluxBlock,
  hasWindowActivity,
  ProjectsBlock,
} from './blocks'
import KpiStrip from './kpi-strip'
import { StatusLegend } from './status-legend'
import { windowReadState } from './model'

const ENTRY = navEntry('/')

export default function CockpitOverview({
  overview,
  nowMs,
}: Readonly<{ overview: DashboardOverview; nowMs: number }>) {
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const unread = overview.windowRuns === null
  const hasRuns = runs !== null && runs.length > 0
  const windowState = windowReadState(unread, overview.kpis.runs24h)
  const showActivity = hasWindowActivity(buckets)

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
            <Button href="/actions" className="aig-btn-accent">
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
            {slices ? (
              <StatusLegend
                slices={slices}
                lead={`Fenêtre 24 heures${
                  windowState === 'unread' ? ' · non lue' : windowState === 'empty' ? ' · lue, vide' : ''
                }`}
              />
            ) : null}

            <KpiStrip kpis={overview.kpis} unread={unread} />

            {showActivity ? (
              <>
                <div className="aig-hairline" />
                <ActivityPanel buckets={buckets} />
              </>
            ) : windowState === 'empty' ? (
              <FluxAbsentLine />
            ) : windowState === 'unread' ? (
              <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
            ) : null}
          </div>

          <div className="aig-hairline" />

          <div className="overview-zone">
            <header className="min-w-0">
              <p className="aig-text-faint text-2xs font-medium uppercase tracking-[0.16em] opacity-85">
                Zone opérateur
              </p>
              <h2 className="aig-h2 mt-2 text-[1.375rem] sm:text-[1.5rem]">Opérations & catalogue</h2>
              <p className="aig-text-faint mt-2 text-2xs uppercase tracking-[0.12em] opacity-90">
                {hasRuns
                  ? 'Flux récent, projets et signaux de la fenêtre courante'
                  : 'Signaux et projets — flux vide sur la fenêtre 24 h'}
              </p>
            </header>

            {hasRuns && runs ? (
              <div className="grid min-w-0 grid-cols-1 gap-8 xl:grid-cols-2 xl:items-stretch xl:gap-10">
                <FluxBlock runs={runs} nowMs={nowMs} className="min-h-78 xl:h-full" />
                <div className="grid min-w-0 gap-8 xl:h-full xl:grid-rows-2 xl:gap-8">
                  <ProjectsBlock overview={overview} className="min-h-38 xl:h-full" />
                  <EventsBlock overview={overview} className="min-h-38 xl:h-full" />
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 gap-8 md:grid-cols-2 md:items-stretch md:gap-10">
                <EventsBlock overview={overview} className="min-h-56 md:h-full" />
                <ProjectsBlock overview={overview} className="min-h-56 md:h-full" />
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
