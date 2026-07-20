import clsx from 'clsx'

import { Text } from '@/components/catalyst/text'
import type { TelemetryHealthDiagnostic } from '@/lib/agent-mission-control/telemetry-health'
import { InformationCircleIcon, SignalIcon } from '@heroicons/react/24/outline'

/**
 * TelemetryHealthBanner — surfaces `diagnoseTelemetryHealth` at the top of
 * /admin/telemetry. Mono-accent: `healthy` is a single discreet zinc/accent
 * line, every other status uses the same accent-intensity roles the rest of
 * the dashboard uses for emphasis (`--accent-surface` / `--accent-line`) —
 * never a red/orange alert color, and never a claim about agent activity.
 * The `summary` string is rendered verbatim: it is already worded by the
 * diagnostic module to avoid implying agents are inactive when the loop is
 * merely silent or unconfigured.
 */
export function TelemetryHealthBanner({ diagnostic }: { diagnostic: TelemetryHealthDiagnostic }) {
  if (diagnostic.status === 'healthy') {
    return (
      <div className="flex items-center gap-2 px-1 text-zinc-500">
        <SignalIcon aria-hidden="true" className="size-4 shrink-0 text-accent-600" />
        <Text className="text-zinc-500">{diagnostic.summary}</Text>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex items-start gap-3 rounded-2xl px-6 py-4',
        'bg-[var(--accent-surface)] ring-1 ring-[var(--accent-line)]'
      )}
    >
      <InformationCircleIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-accent-500" />
      <div className="flex flex-col gap-1">
        <Text className="font-medium text-zinc-100">{telemetryStatusLabel(diagnostic.status)}</Text>
        <Text className="text-zinc-400">{diagnostic.summary}</Text>
      </div>
    </div>
  )
}

function telemetryStatusLabel(status: TelemetryHealthDiagnostic['status']): string {
  switch (status) {
    case 'not_configured':
      return 'Telemetry ingestion not configured'
    case 'incomplete_configuration':
      return 'Telemetry configuration incomplete'
    case 'loop_muted':
      return 'Telemetry loop is silent'
    case 'unavailable':
      return 'Telemetry health unknown'
    default:
      return 'Telemetry'
  }
}
