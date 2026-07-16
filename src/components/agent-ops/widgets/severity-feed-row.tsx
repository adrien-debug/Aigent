import NextLink from 'next/link'

import { formatRelative } from '@/lib/agent-mission-control/format'

type Severity = 'warning' | 'danger'

const severityLabel: Record<Severity, string> = {
  warning: 'Warning',
  danger: 'Danger',
}

/**
 * SeverityFeedRow — one dense line for the overview warnings feed. Severity
 * is a plain muted text label — the label text is ALWAYS present, so colour
 * is never the sole signal. Server-safe (no hooks).
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
      <span className="shrink-0 text-xs font-medium text-zinc-500 dark:text-zinc-400">
        {severityLabel[severity]}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-300" title={message}>
        {message}
      </span>
      {copilotName ? (
        <span className="hidden shrink-0 text-xs text-zinc-500 dark:text-zinc-400 sm:inline">
          {copilotName}
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
        className="-my-3 shrink-0 py-3 text-xs font-medium text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-white"
      >
        Investigate
        <span className="sr-only"> {copilotName ?? 'this'} warning</span>
      </NextLink>
    </div>
  )
}
