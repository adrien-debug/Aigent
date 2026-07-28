import { Subheading } from '@/components/ui/heading'
import { Link } from '@/components/ui/link'
import { Panel } from '@/components/ui/panel'
import { Text } from '@/components/ui/text'
import type { AgentActivityRow } from '@/lib/aigent-v2/runs-activity'
import { formatUsd } from '@/lib/aigent-v2/runs-metrics'

function relativeTime(iso: string, nowMs: number): string | null {
  const ms = Date.parse(iso)
  if (!Number.isFinite(ms)) return null
  const diff = Math.max(0, nowMs - ms)
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
}

/**
 * The 1/3 surface of the bottom row: the agents behind the runs currently in
 * view, busiest first. Derived from the same filtered array as the table, so
 * the panel and the rows can never tell two different stories.
 */
export function RunsActivityPanel({
  rows,
  nowMs,
  agentsDegraded,
}: {
  rows: AgentActivityRow[]
  nowMs: number
  agentsDegraded: boolean
}) {
  return (
    <Panel inset="md" className="flex flex-col" role="region" aria-labelledby="v2-activity-heading">
      <Subheading id="v2-activity-heading" level={2}>
        Most active agents
      </Subheading>
      <Text size="xs" className="mt-1">
        In the current filtered view
      </Text>

      {rows.length === 0 ? (
        <Text size="xs" className="mt-6">
          No agent has a run in this view.
        </Text>
      ) : (
        <ul className="mt-4 flex flex-col gap-2">
          {rows.map((row) => {
            const last = relativeTime(row.lastStartedAt, nowMs)
            return (
              <li key={row.copilotId}>
                <Link
                  href={`/admin/agents/${row.copilotId}`}
                  className="flex items-center gap-3 rounded-xl bg-surface-sunken px-4 py-3 ring-1 ring-[var(--surface-border)] hover:ring-[var(--surface-border-strong)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-white">{row.name}</span>
                    <span className="mt-0.5 block text-[11px]/4 text-zinc-400">
                      {row.runs} run{row.runs === 1 ? '' : 's'}
                      {row.failed > 0 ? ` · ${row.failed} failed` : ''}
                      {row.blocked > 0 ? ` · ${row.blocked} blocked` : ''}
                      {last ? ` · ${last}` : ''}
                      {!row.nameResolved ? ' · name unavailable' : ''}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-xs text-zinc-300 tabular-nums">
                      {row.measuredCostUsd === null ? '—' : formatUsd(row.measuredCostUsd)}
                    </span>
                    {row.running > 0 ? (
                      <span className="mt-0.5 block text-[11px]/4 text-zinc-400">
                        {row.running} running
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      {agentsDegraded ? (
        <Text size="2xs" className="mt-4">
          The agent catalogue could not be read, so some rows show a raw agent id instead of a name.
        </Text>
      ) : null}
    </Panel>
  )
}
