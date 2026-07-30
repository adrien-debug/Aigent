import { StatusDot, type StatusDotTone } from '@/components/ui/status-dot'
import type { LifecycleTrace } from '@/lib/agent-mission-control/agent-lifecycle-trace'

import { Section, Unavailable } from './screen-primitives'

/**
 * Renders the governed agent lifecycle (`agent-lifecycle-trace.ts`): draft →
 * tested → qualified → production → delivered → active in consumer →
 * telemetry received → improvement proposed → V2 draft.
 *
 * EACH STAGE SHOWS ITS OWN SOURCE. No collapsed single status: the dot tone
 * comes only from `reached`/`evidence.state`, and the source line under each
 * stage names the table/module the fact came from — the same discipline
 * `agent-detail.ts`'s header requires of every other panel on this page.
 *
 * `reached: 'unknown'` (only possible for `active_in_consumer`, and for
 * `telemetry_received` when the lookup itself failed) renders the neutral
 * ring dot — same visual language as "not measured" elsewhere in the
 * console, never the danger role: an unknown boundary is not a failure.
 */

function stageTone(reached: boolean | 'unknown'): StatusDotTone {
  if (reached === 'unknown') return 'neutral'
  return reached ? 'positive' : 'neutral'
}

export function LifecycleTracePanel({ lifecycle }: { lifecycle: LifecycleTrace }) {
  const { stages, versionDrift } = lifecycle
  return (
    <Section
      title="Lifecycle"
      description="Each stage is sourced independently — reaching one never implies the next"
      scroll="lg"
    >
      <ol className="divide-y divide-line">
        {stages.map((stage) => (
          <li key={stage.key} className="px-4 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <StatusDot tone={stageTone(stage.reached)}>{stage.label}</StatusDot>
              <span className="shrink-0 text-[10px]/4 uppercase tracking-widest text-content-faint">
                {stage.evidence.source}
              </span>
            </div>
            <p className="mt-1 text-[11px]/4 text-content-subtle">{stage.evidence.detail}</p>
          </li>
        ))}
      </ol>
      <div className="border-t border-line px-4 py-2.5">
        <p className="text-[10px]/4 font-semibold uppercase tracking-widest text-content-subtle">Version drift</p>
        {versionDrift.state === 'unknown' ? (
          <p className="mt-1 text-[11px]/4 text-content-subtle">
            <Unavailable /> — {versionDrift.detail}
          </p>
        ) : (
          <p className="mt-1 text-[11px]/4 text-content-muted">
            {versionDrift.driftDetected ? (
              <span className="text-[var(--state-danger-text)]">
                Drift detected: delivered {versionDrift.lastDeliveredVersionLabel} · reported{' '}
                {versionDrift.lastReportedVersion}
              </span>
            ) : (
              versionDrift.detail
            )}
          </p>
        )}
      </div>
    </Section>
  )
}
