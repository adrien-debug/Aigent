import { SignalIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunDetailPanel, RunStatusBadge } from '@/components/agent-ops/run-detail-panel'
import { Button } from '@/components/catalyst/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatTimestamp } from '@/lib/agent-mission-control/format'
import { getCopilot, getRunsForCopilot, getStepsForRun, getToolCallsForRun } from '@/lib/agent-mission-control/data'
import type { ToolCall } from '@/lib/agent-mission-control/types'

const toolCallStatuses = [
  { status: 'ok', label: 'OK', dotClassName: 'bg-zinc-500' },
  { status: 'confirmed', label: 'Confirmed', dotClassName: 'bg-green-400' },
  { status: 'error', label: 'Error', dotClassName: 'bg-rose-400' },
  { status: 'blocked', label: 'Blocked', dotClassName: 'bg-rose-400' },
  { status: 'rejected', label: 'Rejected', dotClassName: 'bg-rose-400' },
] satisfies { status: ToolCall['status']; label: string; dotClassName: string }[]

export default async function RunsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { id } = await params
  const copilot = await getCopilot(id)
  if (!copilot) notFound()

  const sp = await searchParams
  const runs = [...(await getRunsForCopilot(id))].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))

  const requestedRunId = typeof sp.run === 'string' ? sp.run : undefined
  const selectedRun = runs.find((run) => run.id === requestedRunId) ?? runs[0]

  const [allToolCallsByRun, selectedSteps, selectedToolCalls] = await Promise.all([
    Promise.all(runs.map((run) => getToolCallsForRun(run.id))),
    selectedRun ? getStepsForRun(selectedRun.id) : [],
    selectedRun ? getToolCallsForRun(selectedRun.id) : [],
  ])
  const allToolCalls = allToolCallsByRun.flat()
  const toolCallCounts = allToolCalls.reduce<Record<ToolCall['status'], number>>(
    (acc, call) => {
      acc[call.status] += 1
      return acc
    },
    { ok: 0, error: 0, blocked: 0, confirmed: 0, rejected: 0 }
  )

  return (
    <div className="space-y-8">
      {runs.length === 0 || !selectedRun ? (
        <div className="rounded-xl bg-white px-6 py-12 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
          <div className="mx-auto max-w-md text-center">
            <SignalIcon aria-hidden="true" className="mx-auto size-8 text-zinc-400 dark:text-zinc-600" />
            <h2 className="mt-4 text-base font-semibold text-zinc-950 dark:text-white">No runs yet</h2>
            <Text className="mt-2">
              This copilot hasn&apos;t served any production traffic. Run its test suites to validate behavior, then
              activate it to see live runs, steps and tool calls here.
            </Text>
            <div className="mt-6 flex justify-center">
              <Button outline href={`/admin/agents/${id}/tests`}>
                Go to tests
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-5 lg:items-start">
          <div className="space-y-6 lg:col-span-2">
            <AgentSectionCard
              title="Recent runs"
              description="Newest first. Select a run to inspect its timeline."
              contentClassName="px-6 py-4"
            >
              <Table dense bleed className="[--gutter:--spacing(6)]">
                <TableHead>
                  <TableRow>
                    <TableHeader>Run</TableHeader>
                    <TableHeader>Status</TableHeader>
                    <TableHeader>Input</TableHeader>
                    <TableHeader>Started</TableHeader>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {runs.map((run) => {
                    const selected = run.id === selectedRun.id
                    return (
                      <TableRow
                        key={run.id}
                        href={`/admin/agents/${id}/runs?run=${run.id}`}
                        title={`Inspect run ${run.id}`}
                        className={clsx(selected && 'bg-zinc-950/5 dark:bg-white/5')}
                      >
                        <TableCell>
                          <span className="font-mono text-xs font-medium tabular-nums text-zinc-950 dark:text-white">{run.id}</span>
                        </TableCell>
                        <TableCell>
                          <RunStatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="max-w-0 w-full">
                          <span title={run.inputSummary} className="block truncate text-zinc-500 dark:text-zinc-400">
                            {run.inputSummary}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-zinc-500">
                          {formatTimestamp(run.startedAt).replace(' UTC', '')}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </AgentSectionCard>

            <AgentSectionCard title="Tool calls" description="Outcomes across the runs above.">
              {/* Flat stat pairs — no boxed sub-surfaces inside a card (doctrine: surfaces). */}
              <dl className="flex flex-wrap gap-x-6 gap-y-2">
                {toolCallStatuses.map(({ status, label, dotClassName }) => (
                  <div key={status} className="flex items-baseline gap-2">
                    <span aria-hidden="true" className={clsx('size-1.5 shrink-0 self-center rounded-full', dotClassName)} />
                    <dt className="text-xs text-zinc-500 dark:text-zinc-400">{label}</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums text-zinc-950 dark:text-white">
                      {toolCallCounts[status]}
                    </dd>
                  </div>
                ))}
              </dl>
            </AgentSectionCard>
          </div>

          <div className="lg:col-span-3">
            <RunDetailPanel run={selectedRun} steps={selectedSteps} toolCalls={selectedToolCalls} />
          </div>
        </div>
      )}
    </div>
  )
}
