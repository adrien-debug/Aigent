import { ArrowTopRightOnSquareIcon } from '@heroicons/react/20/solid'
import type { Metadata } from 'next'

import { AgentKpiBand } from '@/components/agent-ops/agent-kpi-band'
import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunStatusBadge } from '@/components/agent-ops/run-detail-panel'
import { Link } from '@/components/catalyst/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { getCopilots, getRecentRuns } from '@/lib/agent-mission-control/data'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'

export const metadata: Metadata = {
  title: 'Traces — Agent Mission Control',
}

export default async function TracesPage() {
  const [runs, copilots] = await Promise.all([getRecentRuns(30), getCopilots()])
  const copilotNameById = new Map(copilots.map((copilot) => [copilot.id, copilot.name]))

  const tracedCount = runs.filter((run) => run.traceUrl !== null).length
  const failureCount = runs.filter((run) => run.status === 'failed' || run.status === 'blocked').length
  const avgLatencyMs =
    runs.length > 0 ? Math.round(runs.reduce((sum, run) => sum + run.latencyMs, 0) / runs.length) : null

  return (
    <div className="space-y-8">
      {/* KPI en haut, marge au-dessus = petit header (directive Adrien 2026-07-10) */}
      <AgentKpiBand
        className="mt-2"
        stats={[
          { name: 'Traced runs', value: String(tracedCount), hint: `last ${runs.length} runs` },
          {
            name: 'Failures',
            value: String(failureCount),
            changeType: failureCount > 0 ? 'negative' : undefined,
            hint: 'Failed + blocked',
          },
          {
            name: 'Avg latency',
            value: avgLatencyMs === null ? '—' : formatDurationMs(avgLatencyMs),
            hint: 'Mean across recent runs',
          },
        ]}
      />

      <AgentSectionCard
        title="Recent traces"
        description="Latest runs across all copilots — deep links open in LangSmith."
        contentClassName="p-0"
      >
        {runs.length > 0 ? (
          <div className="px-6 [--gutter:--spacing(6)]">
            <Table bleed dense>
              {/* Accessible name must land on the <table> itself — Catalyst spreads props on its scroll wrapper. */}
              <caption className="sr-only">Recent traced runs</caption>
              <TableHead>
                <TableRow>
                  <TableHeader>Run</TableHeader>
                  <TableHeader>Copilot</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Input</TableHeader>
                  <TableHeader>Latency</TableHeader>
                  <TableHeader>Cost</TableHeader>
                  <TableHeader>Started</TableHeader>
                  <TableHeader>Trace</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <span className="font-mono text-xs font-medium tabular-nums text-zinc-950 dark:text-white">
                        {run.id}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Link
                        href={`/admin/agents/${run.copilotId}/runs?run=${run.id}`}
                        className="text-sm font-medium text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-white"
                      >
                        {copilotNameById.get(run.copilotId) ?? run.copilotId}
                        <span className="sr-only"> — inspect run {run.id}</span>
                      </Link>
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    {/* max-w-0 + w-full : la colonne Input absorbe la largeur restante et tronque — jamais de scroll latéral. */}
                    <TableCell className="w-full max-w-0">
                      <span title={run.inputSummary} className="block truncate text-zinc-500 dark:text-zinc-400">
                        {run.inputSummary}
                      </span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatDurationMs(run.latencyMs)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {formatUsd(run.costUsd)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500">
                      {formatTimestamp(run.startedAt).replace(' UTC', '')}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {run.traceUrl ? (
                        // Famille violet/blue = runtime & tracing UNIQUEMENT — ici c'est le cas légitime (lien LangSmith).
                        <Link
                          href={run.traceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-md bg-violet-500/10 px-2 py-1 text-xs font-medium text-violet-600 hover:bg-violet-500/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-500 dark:text-violet-400"
                        >
                          Open
                          <ArrowTopRightOnSquareIcon aria-hidden="true" className="size-3.5" />
                          <span className="sr-only"> trace for run {run.id} in LangSmith</span>
                        </Link>
                      ) : (
                        <span className="text-xs text-zinc-500">No trace</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="px-6 py-5 text-sm text-zinc-500 dark:text-zinc-400">
            No runs recorded yet. Traces appear here as soon as copilots serve traffic.
          </p>
        )}
      </AgentSectionCard>
    </div>
  )
}
