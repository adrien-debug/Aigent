import {
  countManifestsWithTelemetryDeclared,
  getCopilots,
  getProjects,
} from '@/lib/agent-mission-control/data'
import {
  listRecentRuntimeTelemetryEvents,
  summarizeFleetRuntimeTelemetry,
  type RuntimeTelemetryEvent,
  type RuntimeTelemetryFleetSummary,
} from '@/lib/agent-mission-control/runtime-telemetry-store'
import { diagnoseTelemetryHealth, type TelemetryHealthDiagnostic } from '@/lib/agent-mission-control/telemetry-health'
import type { Project } from '@/lib/agent-mission-control/types'

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

export interface TelemetryPageData {
  summary: RuntimeTelemetryFleetSummary | null
  events: RuntimeTelemetryEvent[]
  copilotNameById: Map<string, string>
  projectNameById: Map<string, string>
  hasData: boolean
  nowIso: string
  telemetryHealth: TelemetryHealthDiagnostic
}

/**
 * `/admin/telemetry` data-fetch, extracted so `page.tsx` stays a pure
 * `data + <View />` shell (see `scripts/check-views.mjs`).
 */
export async function getTelemetryPageData(): Promise<TelemetryPageData> {
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

  return { summary, events, copilotNameById, projectNameById, hasData, nowIso, telemetryHealth }
}
