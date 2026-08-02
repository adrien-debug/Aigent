import './overview.css'

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

/**
 * UN SEUL AXE GAUCHE. La scène ne portait aucun padding horizontal : son
 * contenu s'appuyait sur le bord de la boîte, et l'en-tête de la zone
 * opérateur ajoutait par-dessus un liseré + `pl-4` qui décalait ce seul titre
 * de 19 px vers la droite (mesuré). Le padding vit désormais sur la scène,
 * une fois, et tout ce qu'elle contient — libellé de zone, bandeau, sections,
 * lignes — démarre exactement sur la même verticale.
 *
 * DEUX ZONES DE MÊME RANG. « Fenêtre 24 heures » et « Opérations & catalogue »
 * portent le même style de libellé : la symétrie de la page est structurelle
 * (mêmes marges, mêmes rangs, même rythme), jamais imposée au contenu — les
 * deux colonnes basses n'ont ni hauteur forcée ni `min-height` accordée à la
 * main, elles descendent chacune à la hauteur de ce qu'elles portent.
 */
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
          className="aig-stage flex min-w-0 flex-col gap-7 p-5 sm:gap-8 sm:p-6"
          aria-label={ENTRY.name}
        >
          {/* ── Zone signal ─────────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2">
              <h2 className="aig-text-muted text-2xs uppercase tracking-[0.14em]">
                {`Fenêtre 24 heures${
                  windowState === 'unread' ? ' · non lue' : windowState === 'empty' ? ' · lue, vide' : ''
                }`}
              </h2>
              {slices ? <StatusLegend slices={slices} /> : null}
            </div>

            <KpiStrip kpis={overview.kpis} unread={unread} />

            {showActivity ? (
              <ActivityPanel buckets={buckets} />
            ) : windowState === 'empty' ? (
              <FluxAbsentLine />
            ) : windowState === 'unread' ? (
              <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
            ) : null}
          </div>

          <div className="aig-hairline" />

          {/* ── Zone opérateur ──────────────────────────────────────────── */}
          <div className="flex min-w-0 flex-col gap-5">
            <h2 className="aig-text-muted text-2xs uppercase tracking-[0.14em]">
              Opérations &amp; catalogue
            </h2>

            {hasRuns && runs ? (
              <div className="grid min-w-0 grid-cols-1 items-start gap-8 xl:grid-cols-2 xl:gap-10">
                <FluxBlock runs={runs} />
                <div className="grid min-w-0 items-start gap-8">
                  <EventsBlock overview={overview} />
                  <ProjectsBlock overview={overview} />
                </div>
              </div>
            ) : (
              <div className="grid min-w-0 grid-cols-1 items-start gap-8 md:grid-cols-2 md:gap-10">
                <EventsBlock overview={overview} />
                <ProjectsBlock overview={overview} />
              </div>
            )}
          </div>
        </section>

        {overview.dataWarnings.length > 0 ? (
          <p className="aig-accent truncate px-1 font-mono text-xs">
            {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
          </p>
        ) : null}
      </PageBody>
    </>
  )
}
