/**
 * Cockpit — écran unique, hauteur du viewport, ZÉRO scroll de page en desktop.
 *
 * COMPOSITION (ce qui a changé, et pourquoi)
 *
 * L'écran précédent alignait six tuiles KPI, un histogramme écrasé à 9 rem, deux
 * panneaux de cartes et un bandeau de projets — tous du même poids visuel. Un
 * cockpit n'est pas une grille homogène : il a un pouls, un instrument
 * principal, et des rosters en périphérie.
 *
 * La hiérarchie est maintenant explicite, du haut vers le bas :
 *  1. la barre d'état du SYSTÈME (`TopBar`) — canal de télémétrie, runtime ;
 *  2. le bandeau d'instruments (`KpiStrip`) — une surface, six mesures, un accent ;
 *  3. l'ACTIVITÉ — l'instrument principal, qui prend enfin la place d'un graphe ;
 *  4. les trois rosters — flux d'exécution, agents, projets — en lignes denses
 *     partageant la même grammaire.
 *
 * Chaque panneau reçoit une hauteur imposée par la grille (`min-h-0` de haut en
 * bas) et borne son contenu : seules les listes scrollent, dans leur box.
 *
 * Server Component : il lit et distribue. L'histogramme est le seul module
 * client (Recharts mesure le DOM).
 */
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildAgentCards, buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { ProjectCard } from '@/lib/cockpit/named-runs'
import { HourlyRunsChart, StatusLegend } from './charts'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import { AgentRow, ProjectRow } from './rows'
import { Panel, Unavailable } from './primitives'

export default function CockpitOverview({
  overview,
  nowMs,
}: {
  overview: DashboardOverview
  nowMs: number
}) {
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const agents = buildAgentCards(overview.windowRuns, overview.copilots, overview.projectRows)
  // `windowRuns === null` ⇒ la lecture a ÉCHOUÉ (contrat de données). Une
  // fenêtre non lue n'est pas une fenêtre calme.
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
  // Un cockpit montre ce qui bouge : les projets actifs passent devant, les
  // coquilles vides ne mangent pas la première place.
  const rankedProjects = [...projectCards].sort(
    (a, b) => (b.runs24h ?? 0) - (a.runs24h ?? 0) || b.copilotCount - a.copilotCount,
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 xl:overflow-hidden">
      <KpiStrip kpis={overview.kpis} unread={unread} />

      {/* ── Instrument principal ── */}
      <Panel
        title="Activité 24 h"
        className="min-h-[15rem] shrink-0 xl:min-h-0 xl:flex-[4] xl:shrink"
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

      {/* ── Rosters ── ils occupent l'espace restant ── */}
      <div className="grid min-h-0 grid-cols-1 gap-3 xl:flex-[8] xl:grid-cols-[1.35fr_1fr] xl:grid-rows-[minmax(0,1fr)]">
        <Panel
          title="Flux d'exécution"
          hint={runs ? `${runs.length} sur la fenêtre` : undefined}
          className="min-h-[18rem] xl:min-h-0"
          padded={false}
        >
          {runs === null ? (
            <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
          ) : runs.length === 0 ? (
            <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
          ) : (
            <RunStream runs={runs} nowMs={nowMs} />
          )}
        </Panel>

        <div className="flex min-h-0 flex-col gap-3">
          <Panel
            title="Agents en vol"
            hint={agents ? `${agents.length} ont tourné` : undefined}
            className="min-h-[13rem] xl:min-h-0 xl:flex-[2]"
            padded={false}
            bodyClassName="scroll-thin overflow-y-auto"
          >
            {agents === null ? (
              <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
            ) : agents.length === 0 ? (
              <Unavailable
                reason="no-data"
                detail="Aucun agent n'a tourné sur les dernières 24 heures."
              />
            ) : (
              <ul>
                {agents.map((card) => (
                  <AgentRow key={card.copilotId} card={card} nowMs={nowMs} />
                ))}
              </ul>
            )}
          </Panel>

          <Panel
            title="Projets"
            hint={`${projectCards.length} au catalogue`}
            className="min-h-[13rem] xl:min-h-0 xl:flex-[3]"
            padded={false}
            bodyClassName="scroll-thin overflow-y-auto"
          >
            {projectCards.length === 0 ? (
              <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
            ) : (
              <ul>
                {rankedProjects.map((card) => (
                  <ProjectRow key={card.id} card={card} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {overview.dataWarnings.length > 0 ? (
        <p className="shrink-0 truncate rounded-md border border-[#be850f]/25 bg-[#be850f]/8 px-3 py-1.5 font-mono text-[10.5px] text-[#d9a635]">
          {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
        </p>
      ) : null}
    </div>
  )
}
