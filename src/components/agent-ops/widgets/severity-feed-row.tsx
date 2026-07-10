import NextLink from 'next/link'

import { Badge } from '@/components/catalyst/badge'
import { formatRelative } from '@/lib/agent-mission-control/format'

type Severity = 'warning' | 'danger'

const severityLabel: Record<Severity, string> = {
  warning: 'Warning',
  danger: 'Danger',
}

/**
 * SeverityFeedRow — one dense line for the overview warnings feed. A FILLED
 * severity pill whose INTENSITY (accentStrong vs accentSolid) distinguishes
 * warning from danger — the label text is ALWAYS present, so colour is never
 * the sole signal. Server-safe (no hooks).
 */
export function SeverityFeedRow({
  severity,
  message,
  copilotName,
  occurredAt,
  referenceNow,
  href,
}: {
  severity: Severity
  message: string
  copilotName?: string
  occurredAt: string
  referenceNow: string
  href: string
}) {
  return (
    <div className="flex items-center gap-3 py-2">
      <Badge color={severity === 'danger' ? 'accentSolid' : 'accentStrong'}>
        {severityLabel[severity]}
      </Badge>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300" title={message}>
        {message}
      </span>
      {copilotName ? (
        <span className="hidden shrink-0 sm:inline">
          <Badge color="zinc">{copilotName}</Badge>
        </span>
      ) : null}
      <time
        dateTime={occurredAt}
        className="hidden shrink-0 font-mono text-xs text-zinc-500 tabular-nums sm:inline"
      >
        {formatRelative(occurredAt, referenceNow)}
      </time>
      <NextLink
        href={href}
        className="shrink-0 text-xs font-medium text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
      >
        Investigate
        <span className="sr-only"> {copilotName ?? 'this'} warning</span>
      </NextLink>
    </div>
  )
}

/**
 * SeverityTally — companion header cluster for the warnings feed: two filled
 * Badges whose intensity matches the rows (Warning = accentStrong, Danger =
 * accentSolid).
 */
export function SeverityTally({ warning, danger }: { warning: number; danger: number }) {
  return (
    <div className="flex items-center gap-2">
      <Badge color="accentStrong" className="font-mono tabular-nums">
        Warning · {warning}
      </Badge>
      <Badge color="accentSolid" className="font-mono tabular-nums">
        Danger · {danger}
      </Badge>
    </div>
  )
}
