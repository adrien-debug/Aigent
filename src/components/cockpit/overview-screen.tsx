/**
 * Cockpit — écran unique, hauteur du viewport, ZÉRO scroll de page.
 *
 * Ce qui a changé après la première passe, et pourquoi :
 *  · Le donut a été SUPPRIMÉ. Il redisait « 3 runs » et « 100 % » que les KPI
 *    affichent déjà, en plus gros — zéro information nouvelle.
 *  · Les jauges de projets ont été SUPPRIMÉES. Huit barres à zéro ne sont pas
 *    une donnée, c'est du remplissage. Remplacées par des cartes de faits.
 *  · Les derniers runs sont apparus : un cockpit dit ce qui SE PASSE, pas ce
 *    qui existe.
 *  · L'histogramme est rétréci — il garde l'information temporelle que rien
 *    d'autre ne porte, mais il ne mange plus la moitié de l'écran.
 *
 * Chaque panneau reçoit une hauteur imposée par la grille (`min-h-0` de haut en
 * bas) et borne son contenu : seules les listes scrollent, dans leur box.
 *
 * Server Component : il lit et distribue. Le graphique est le seul module client
 * (Recharts mesure le DOM).
 */
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildAgentCards, buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { ProjectCard } from '@/lib/cockpit/named-runs'
import { HourlyRunsChart, StatusLegend } from './charts'
import { AgentGridCard, ProjectGridCard } from './cards'
import RecentRuns from './recent-runs'
import { Kpi, Panel, Unavailable } from './primitives'

function fmtUsd(usd: number) {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

export default function CockpitOverview({
  overview,
  nowMs,
}: {
  overview: DashboardOverview
  nowMs: number
}) {
  const { kpis } = overview
  const buckets = buildHourlyBuckets(overview.windowRuns, nowMs)
  const slices = buildStatusBreakdown(overview.windowRuns)
  const runs = buildNamedRuns(overview.windowRuns, overview.copilots, overview.projectRows)
  const agents = buildAgentCards(overview.windowRuns, overview.copilots, overview.projectRows)
  // `windowRuns === null` ⇒ la lecture a ÉCHOUÉ (contrat de données). Une
  // fenêtre non lue n'est pas une fenêtre calme.
  const unread = overview.windowRuns === null
  const reason = unread ? 'unread' : 'no-data'

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
    <div className="flex h-full min-h-0 flex-col gap-4 p-4">
      {/* ── Bandeau KPI ── */}
      <div className="grid shrink-0 grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi
          label="Exécutables"
          value={kpis.executableNow}
          support={
            kpis.executableTotal === null ? 'total indisponible' : `sur ${kpis.executableTotal} au catalogue`
          }
          tone={kpis.executableNow === 0 ? 'warn' : 'good'}
        />
        <Kpi
          label="Runs 24 h"
          value={kpis.runs24h}
          support={unread ? 'fenêtre non lue' : 'fenêtre glissante'}
          unavailableReason={reason}
        />
        <Kpi
          label="Succès 24 h"
          value={kpis.success24h}
          unit="%"
          support={kpis.success24h === null ? 'aucun run terminal' : 'runs terminaux'}
          tone={kpis.success24h === null ? 'neutral' : kpis.success24h >= 90 ? 'good' : 'bad'}
          unavailableReason={reason}
        />
        <Kpi
          label="Coût 24 h"
          value={kpis.cost24h === null ? null : fmtUsd(kpis.cost24h.usd)}
          support={
            kpis.cost24h === null
              ? 'aucun coût mesurable'
              : kpis.cost24h.measuredRuns < kpis.cost24h.totalRuns
                ? `minorant · ${kpis.cost24h.measuredRuns}/${kpis.cost24h.totalRuns} mesurés`
                : `${kpis.cost24h.totalRuns} runs mesurés`
          }
          unavailableReason={reason}
        />
        <Kpi
          label="Bloquées"
          value={kpis.blockedDeliveries}
          support="livraisons à débloquer"
          tone={kpis.blockedDeliveries && kpis.blockedDeliveries > 0 ? 'bad' : 'neutral'}
        />
        <Kpi
          label="À décider"
          value={kpis.needsAction}
          support="décisions en attente"
          tone={kpis.needsAction > 0 ? 'warn' : 'good'}
        />
      </div>

      {/* ── Activité : rétrécie, pleine largeur, hauteur fixe ── */}
      <Panel
        title="Activité 24h"
        hint={buckets ? 'runs par heure, empilés par statut' : undefined}
        className="h-36 shrink-0"
        bodyClassName="min-h-0 flex flex-col gap-2 px-4 py-3"
      >
        {buckets && slices ? (
          <>
            <div className="min-h-0 flex-1">
              <HourlyRunsChart buckets={buckets} />
            </div>
            <div className="shrink-0">
              <StatusLegend slices={slices} />
            </div>
          </>
        ) : (
          <Unavailable
            reason="unread"
            detail="La fenêtre de runs n'a pas pu être lue — aucune courbe n'est tracée."
          />
        )}
      </Panel>

      {/* ── Derniers runs + agents ── occupent l'espace restant ── */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_2fr]">
        <Panel
          title="Derniers runs"
          hint={runs ? `${runs.length} sur la fenêtre` : undefined}
          bodyClassName="min-h-0 overflow-y-auto px-4 py-2"
        >
          {runs === null ? (
            <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
          ) : runs.length === 0 ? (
            <Unavailable reason="no-data" detail="Aucun run sur les dernières 24 heures." />
          ) : (
            <RecentRuns runs={runs} nowMs={nowMs} />
          )}
        </Panel>

        <Panel
          title="Agents actifs"
          hint={agents ? `${agents.length} ont tourné` : undefined}
          bodyClassName="min-h-0 overflow-y-auto p-4"
        >
          {agents === null ? (
            <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
          ) : agents.length === 0 ? (
            <Unavailable reason="no-data" detail="Aucun agent n'a tourné sur les dernières 24 heures." />
          ) : (
            <ul className="grid grid-cols-1 gap-4">
              {agents.map((card) => (
                <AgentGridCard key={card.copilotId} card={card} nowMs={nowMs} />
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Projets ── cartes, hauteur bornée, scroll interne ── */}
      <Panel
        title="Projets"
        hint={`${projectCards.length} au catalogue`}
        className="h-[17.5rem] shrink-0"
        bodyClassName="min-h-0 overflow-y-auto p-4"
      >
        {projectCards.length === 0 ? (
          <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-3">
            {rankedProjects.map((card) => (
              <ProjectGridCard key={card.id} card={card} />
            ))}
          </ul>
        )}
      </Panel>

      {overview.dataWarnings.length > 0 ? (
        <p className="shrink-0 truncate text-xs/6 text-amber-300/80">
          {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
        </p>
      ) : null}
    </div>
  )
}
