import clsx from 'clsx'

import { Strong, Text } from '@/components/ui/text'
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
        {/* No `text-zinc-500`: it duplicated the primitive's own default and,
            under the forced `dark`, was already overridden by
            `dark:text-zinc-400` — a class that described a tone the line never
            rendered. The parent row carries the tone for the icon row. */}
        <Text>{diagnostic.summary}</Text>
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
      {/* Title/summary contrast came from two className overrides that never
          painted: `Text` composes `clsx(className, defaults)`, so its own
          `text-zinc-500 dark:text-zinc-400` is emitted last and wins — and the
          app forces `dark` on <html> (app/layout.tsx), so `dark:text-zinc-400`
          was the ONLY tone this block ever had. Title and summary therefore
          rendered identical: the banner had no hierarchy at all.
          Title → `Strong`, the primitive that already means "brighter, medium
          weight" (`dark:text-white`); summary → bare `Text`, whose default is
          the zinc-400 the dead class was asking for. No `!` needed either way. */}
      <div className="flex flex-col gap-1">
        {/* `Strong` sets no font-size, so it inherited the 16px root while the
            `Text` under it steps down to 14px from 640px up — the two lines of
            one banner would have shared a size on mobile and not on desktop.
            Mirroring `Text`'s exact ramp is additive, not an override (there is
            no default to race), so hierarchy is carried by weight and tone
            alone, which is what the design system asks of a title. */}
        <Strong className="text-base/6 sm:text-sm/6">{telemetryStatusLabel(diagnostic.status)}</Strong>
        <Text>{diagnostic.summary}</Text>
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
