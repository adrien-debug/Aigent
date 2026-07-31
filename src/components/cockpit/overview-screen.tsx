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
import { Heading } from '@/components/ui/heading'
import { Text } from '@/components/ui/text'
import type { DashboardOverview } from '@/lib/agent-mission-control/dashboard-overview'
import { buildHourlyBuckets, buildStatusBreakdown } from '@/lib/cockpit/overview-series'
import { buildAgentCards, buildNamedRuns } from '@/lib/cockpit/named-runs'
import type { AgentCard, NamedRun, ProjectCard } from '@/lib/cockpit/named-runs'
import { HourlyRunsChart, StatusLegend } from './charts'
import KpiStrip from './kpi-strip'
import RunStream from './run-stream'
import { AgentRow, ProjectRow } from './rows'
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

function renderAgentRoster(agents: AgentCard[] | null, nowMs: number): ReactNode {
  if (agents === null) {
    return <Unavailable reason="unread" detail="La fenêtre de runs n'a pas pu être lue." />
  }
  if (agents.length === 0) {
    return (
      <Unavailable
        reason="no-data"
        detail="Aucun agent n'a tourné sur les dernières 24 heures."
      />
    )
  }
  return (
    <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
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
    <div className="flex flex-col gap-4 p-6 pt-16 lg:pt-6 lg:px-8">
      <header>
        <Heading level={1}>{ENTRY.name}</Heading>
        <Text className="mt-1">{ENTRY.purpose}</Text>
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

        <div className="flex flex-col gap-4">
          <Panel
            title="Agents en vol"
            hint={agents ? `${agents.length} ont tourné` : undefined}
            padded={false}
          >
            {renderAgentRoster(agents, nowMs)}
          </Panel>

          <Panel
            title="Projets"
            hint={`${projectCards.length} au catalogue`}
            padded={false}
          >
            {projectCards.length === 0 ? (
              <Unavailable reason="no-data" detail="Aucun projet dans le catalogue." />
            ) : (
              <ul className="divide-y divide-zinc-950/5 dark:divide-white/5">
                {rankedProjects.map((card) => (
                  <ProjectRow key={card.id} card={card} />
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>

      {overview.dataWarnings.length > 0 ? (
        <p className="truncate rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 font-mono text-2xs text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/8 dark:text-amber-400">
          {overview.dataWarnings.length} avertissement(s) de lecture — {overview.dataWarnings[0]}
        </p>
      ) : null}
    </div>
  )
}
