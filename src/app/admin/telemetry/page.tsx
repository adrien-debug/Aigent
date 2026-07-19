import type { Metadata } from 'next'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { TelemetryAgentsTable } from '@/components/agent-ops/telemetry/telemetry-agents-table'
import { TelemetryErrorBreakdown } from '@/components/agent-ops/telemetry/telemetry-error-breakdown'
import { TelemetryEventsTable } from '@/components/agent-ops/telemetry/telemetry-events-table'
import { TelemetryKpiBand } from '@/components/agent-ops/telemetry/telemetry-kpi-band'
import { getCopilots, getProjects } from '@/lib/agent-mission-control/data'
import {
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
} from '@/lib/agent-mission-control/runtime-telemetry-store'
import type { Project } from '@/lib/agent-mission-control/types'
import { SignalIcon } from '@heroicons/react/24/outline'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Telemetry — Aigent',
}

/** Newest events shown in the feed table. */
const EVENTS_TABLE_SIZE = 30

/** Fail-soft: a telemetry backend hiccup must never break the page — same contract as runtime-telemetry-card.tsx. */
async function loadTelemetry() {
  try {
    const [summary, events] = await Promise.all([
      summarizeFleetRuntimeTelemetry(),
      listRecentRuntimeTelemetryEvents(EVENTS_TABLE_SIZE),
    ])
    return { summary, events }
  } catch (err) {
    console.error('[admin/telemetry] failed to load runtime telemetry', err instanceof Error ? err.message : err)
    return { summary: null, events: [] }
  }
}

export default async function TelemetryPage() {
  const [{ summary, events }, copilots, projects] = await Promise.all([
    loadTelemetry(),
    getCopilots(),
    getProjects(),
  ])

  const nowIso = new Date().toISOString()
  const copilotNameById = new Map(copilots.map((c) => [c.id, c.name]))
  const projectNameById = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]))

  const hasData = summary !== null && summary.totalRuns > 0

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AdminPageHeader
          eyebrow="Telemetry"
          title="Runtime Telemetry"
          description="Opt-in signal reported by delivered agents across every project — Aigent's only window into production traffic once an agent ships."
          actions={<LiveRefresh initialRefreshedAt={nowIso} />}
        />
        {hasData ? (
          <TelemetryKpiBand summary={summary} />
        ) : (
          <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01]">
            <EmptyState
              icon={SignalIcon}
              title="No runtime telemetry yet"
              description="Telemetry is opt-in from each delivered agent's runtime — this page fills in as soon as any agent, in any project, reports its first event."
            />
          </div>
        )}
      </StaggerFade>

      {hasData ? (
        <>
          <StaggerFade delay={1}>
            <TelemetryAgentsTable
              rows={summary.byAgent}
              copilotNameById={copilotNameById}
              projectNameById={projectNameById}
            />
          </StaggerFade>

          <StaggerFade delay={2}>
            <TelemetryErrorBreakdown categories={summary.topErrorCategories} />
          </StaggerFade>

          <StaggerFade delay={3}>
            <TelemetryEventsTable
              events={events}
              copilotNameById={copilotNameById}
              projectNameById={projectNameById}
              nowIso={nowIso}
            />
          </StaggerFade>
        </>
      ) : null}
    </div>
  )
}
