import { LiveRefresh } from '@/components/agent-ops/performance/live-refresh'
import { StaggerFade } from '@/components/agent-ops/stagger-fade'
import { TelemetryAgentsTable } from '@/components/agent-ops/telemetry/telemetry-agents-table'
import { TelemetryErrorBreakdown } from '@/components/agent-ops/telemetry/telemetry-error-breakdown'
import { TelemetryEventsTable } from '@/components/agent-ops/telemetry/telemetry-events-table'
import { TelemetryHealthBanner } from '@/components/agent-ops/telemetry-health-banner'
import { TelemetryKpiBand } from '@/components/agent-ops/telemetry/telemetry-kpi-band'
import { TelemetryUnconfiguredState } from '@/components/agent-ops/telemetry/telemetry-unconfigured-state'
import { PageHeader } from '@/components/shell/page-header'
import { PageLayout } from '@/components/shell/page-layout'
import type { TelemetryPageData } from '@/lib/agent-mission-control/telemetry-page-data'

export function TelemetryView({
  summary,
  events,
  copilotNameById,
  projectNameById,
  hasData,
  nowIso,
  telemetryHealth,
}: TelemetryPageData) {
  return (
    <PageLayout className="gap-8 pb-12">
      <StaggerFade delay={0}>
        <PageHeader
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
        {hasData && summary ? (
          <TelemetryKpiBand summary={summary} />
        ) : (
          <TelemetryUnconfiguredState diagnostic={telemetryHealth} />
        )}
      </StaggerFade>

      {hasData && summary ? (
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
    </PageLayout>
  )
}
