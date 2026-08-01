/**
 * Overview — instruments et rosters sur fond clair, scroll document naturel.
 *
 * Hiérarchie : bandeau KPI → activité (histogramme) → rosters (flux, agents,
 * projets). Pas de bandeau shell : tout vit dans la zone de travail blanche.
 *
 * Server Component : l'histogramme est le seul module client (Recharts).
 */
import type { ReactNode } from 'react'
import { navEntry } from '@/components/navigation'
import { Absent, Panel } from '@/components/design/surface'
import { BandLabel, Body, Kicker, PageTitle } from '@/components/design/type'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildAgentCards, buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { AgentCard, NamedRun, ProjectCard } from '@/lib/cockpit/named-runs'
import { SEVERITY } from '@/lib/cockpit/status'
import { HourlyRunsChart, StatusLegend } from './charts'
import KpiBands from './kpi-bands'
import RunStream from './run-stream'
import { AgentRow, ProjectRow } from './rows'

const ENTRY = navEntry('/')

/**
 * L'absence, centrée dans le corps d'un panneau.
 *
 * `Absent` est une marque en ligne ; dans un panneau vide elle doit être
 * posée au centre avec sa raison, sinon elle se colle au bord et se lit
 * comme une étiquette plutôt que comme un état.
 */
function EmptyBody({
  reason,
  detail,
}: Readonly<{ reason: 'unread' | 'no-data'; detail: string }>) {
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-9 text-center">
      <Absent reason={reason} />
      <Body className="max-w-[38ch] text-xs/5 text-fg-low">{detail}</Body>
    </div>
  )
}

function renderRunStreamPanel(runs: NamedRun[] | null, nowMs: number): ReactNode {
  if (runs === null) {
    return <EmptyBody reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (runs.length === 0) {
    return <EmptyBody reason="no-data" detail="Aucun run sur les dernières 24 heures." />
  }
  return <RunStream runs={runs} nowMs={nowMs} />
}

function renderAgentRoster(agents: AgentCard[] | null, nowMs: number): ReactNode {
  if (agents === null) {
    return <EmptyBody reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (agents.length === 0) {
    return (
      <EmptyBody reason="no-data" detail="Aucun agent n'a tourné sur les dernières 24 heures." />
    )
  }
  return (
    <ul className="divide-y divide-line">
      {agents.map((card) => (
        <AgentRow key={card.copilotId} card={card} nowMs={nowMs} />
      ))}
    </ul>
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
  const agents = buildAgentCards(overview.windowRuns, overview.copilots, overview.projectRows)
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
    // Le fond d'encre est porté ICI et non par le `body` : les autres surfaces
    // n'ont pas encore migré, et repeindre le document entier les casserait.
    <div className="min-h-svh bg-ink-900 p-6 pt-16 lg:px-8 lg:pt-7">
      <header className="mb-7">
        <Kicker>Fenêtre 24 heures</Kicker>
        <PageTitle className="mt-2">{ENTRY.name}</PageTitle>
        <Body className="mt-1.5 max-w-[62ch]">{ENTRY.purpose}</Body>
      </header>

      <BandLabel className="mb-3">Demande une décision</BandLabel>
      <KpiBands kpis={overview.kpis} unread={unread} />

      <BandLabel className="mt-7 mb-3">Activité</BandLabel>
      <Panel
        title="Runs par heure"
        hint={slices ? undefined : 'fenêtre non lue'}
        actions={slices ? <StatusLegend slices={slices} /> : undefined}
        bodyClassName="px-2 pt-3 pb-1"
      >
        {buckets ? (
          <HourlyRunsChart buckets={buckets} />
        ) : (
          <EmptyBody
            reason="unread"
            detail="La fenêtre de runs n'a pas pu être lue — aucune courbe n'est tracée."
          />
        )}
      </Panel>

      <BandLabel className="mt-7 mb-3">Flotte</BandLabel>
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.35fr_1fr] [&>*]:min-w-0">
        <Panel title="Flux d'exécution" hint={runs ? `${runs.length} sur la fenêtre` : undefined}>
          {renderRunStreamPanel(runs, nowMs)}
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title="Agents en vol" hint={agents ? `${agents.length} ont tourné` : undefined}>
            {renderAgentRoster(agents, nowMs)}
          </Panel>

          <Panel title="Projets" hint={`${projectCards.length} au catalogue`}>
            {projectCards.length === 0 ? (
              <EmptyBody reason="no-data" detail="Aucun projet dans le catalogue." />
            ) : (
              <ul className="divide-y divide-line">
                {rankedProjects.map((card) => (
                  <ProjectRow key={card.id} card={card} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {overview.dataWarnings.length > 0 ? (
        <p
          className="mt-5 truncate border-l-2 px-3 py-2 font-mono text-2xs"
          style={{
            borderColor: SEVERITY.warn,
            background: 'color-mix(in srgb, var(--color-ink-800) 70%, transparent)',
            color: SEVERITY.warn,
          }}
        >
          {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
        </p>
      ) : null}
    </div>
  )
}
