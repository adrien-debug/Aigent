import type { Metadata } from 'next'

import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { AdminPageHeader } from '@/components/agent-ops/surface-card'
import { TelemetryAgentsTable } from '@/components/agent-ops/telemetry/telemetry-agents-table'
import { TelemetryErrorBreakdown } from '@/components/agent-ops/telemetry/telemetry-error-breakdown'
import { TelemetryEventsTable } from '@/components/agent-ops/telemetry/telemetry-events-table'
import { TelemetryHealthBanner } from '@/components/agent-ops/telemetry-health-banner'
import { TelemetryKpiBand } from '@/components/agent-ops/telemetry/telemetry-kpi-band'
import { TelemetryUnconfiguredState } from '@/components/agent-ops/telemetry/telemetry-unconfigured-state'
import {
  countManifestsWithTelemetryDeclared,
  getCopilots,
  getProjects,
} from '@/lib/agent-mission-control/data'
import {
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
} from '@/lib/agent-mission-control/runtime-telemetry-store'
import { diagnoseTelemetryHealth } from '@/lib/agent-mission-control/telemetry-health'
import type { Project } from '@/lib/agent-mission-control/types'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Telemetry — Aigent',
}

/** Newest events shown in the feed table. */
const EVENTS_TABLE_SIZE = 30

/** Days without a received event before the loop counts as muted (see telemetry-health.ts). */
const MUTE_THRESHOLD_DAYS = 7

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
    getCopilots({ health: 'list' }),
    getProjects(),
  ])

  const nowIso = new Date().toISOString()
  const copilotNameById = new Map(copilots.map((c) => [c.id, c.name]))
  const projectNameById = new Map<string, string>(projects.map((p: Project) => [p.id, p.name]))

  const hasData = summary !== null && summary.totalRuns > 0

  // One exact count, not an N+1: `null` here would collapse three different
  // situations (nobody opted in / opted in but silent / healthy) into a single
  // "unavailable", which is precisely what this banner exists to tell apart.
  const declaredCount = await countManifestsWithTelemetryDeclared().catch(() => null)

  const telemetryHealth = diagnoseTelemetryHealth({
    ingestionTokenConfigured: Boolean(process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN),
    agentsWithTelemetryDeclared: declaredCount,
    lastEventReceivedAt: summary?.lastSeenAt ?? null,
    lastEventLookupFailed: summary === null,
    now: nowIso,
    muteThresholdDays: MUTE_THRESHOLD_DAYS,
  })

  return (
    <div className="flex flex-col gap-8 pb-12">
      <StaggerFade delay={0}>
        <AdminPageHeader
          eyebrow="Telemetry"
          title="Runtime Telemetry"
          description="Opt-in signal reported by delivered agents across every project — Aigent's only window into production traffic once an agent ships."
          // The LIVE pill is the auto-refresh indicator, but on a page whose whole
          // message is "ingestion is not configured" a green LIVE badge reads as
          // "telemetry is live". Nothing is being received, so nothing claims to
          // be live: the indicator only appears once there is real data to refresh.
          actions={hasData ? <LiveRefresh initialRefreshedAt={nowIso} /> : null}
        />
        {/* The banner is the one-line status; when there is no data at all the
            unconfigured state below already carries that summary verbatim, so
            showing both would print the same sentence twice. */}
        {hasData ? <TelemetryHealthBanner diagnostic={telemetryHealth} /> : null}
        {hasData ? (
          <TelemetryKpiBand summary={summary} />
        ) : (
          <TelemetryUnconfiguredState diagnostic={telemetryHealth} />
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
            <TelemetryErrorBreakdown
              categories={summary.topErrorCategories}
              categoriesState={summary.measurement.errorCategories}
            />
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
