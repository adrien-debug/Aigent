import { SignalIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { AgentSectionCard } from '@/components/agent-ops/agent-section-card'
import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'
import { RunDetailPanel } from '@/components/agent-ops/run-detail-panel'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { SplitBar, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import { formatDurationMs, formatTimestamp } from '@/lib/agent-mission-control/format'
import {
  getCopilot,
  getRunsForCopilot,
  getStepsForRun,
  getToolCallsForRun,
  getToolCallsForRuns,
  getVersion,
} from '@/lib/agent-mission-control/data'
import { TOOL_CALL_STATUS_LABELS } from '@/lib/agent-mission-control/labels'
import type { ToolCall } from '@/lib/agent-mission-control/types'

/**
 * Tool-call outcome ramp — one accent intensity per outcome (severity by fill,
 * never a second hue), ordered calm → hot so the SplitBar reads as an escalation.
 */
const toolCallRamp = [
  { status: 'ok', label: TOOL_CALL_STATUS_LABELS.ok, tone: 'zinc' },
  { status: 'confirmed', label: TOOL_CALL_STATUS_LABELS.confirmed, tone: 'accent-400' },
  { status: 'rejected', label: TOOL_CALL_STATUS_LABELS.rejected, tone: 'accent-500' },
  { status: 'blocked', label: TOOL_CALL_STATUS_LABELS.blocked, tone: 'accent-600' },
  { status: 'error', label: TOOL_CALL_STATUS_LABELS.error, tone: 'accent-700' },
] satisfies { status: ToolCall['status']; label: string; tone: SplitTone }[]

function statusLabel(s: string) {
  const t = s.replace(/-/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

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

  const [allToolCalls, selectedSteps, selectedToolCalls, selectedVersion] = await Promise.all([
    getToolCallsForRuns(runs.map((run) => run.id)),
    selectedRun ? getStepsForRun(selectedRun.id) : [],
    selectedRun ? getToolCallsForRun(selectedRun.id) : [],
    selectedRun ? getVersion(selectedRun.versionId) : undefined,
  ])
  // Chart data: chronological (oldest → newest), plain serializable objects only.
  const latencyPoints = [...runs].reverse().map((run) => ({
    id: run.id,
    label: formatTimestamp(run.startedAt).replace(' UTC', ''),
    latencyMs: run.latencyMs,
    costUsd: run.costUsd,
    status: run.status,
  }))

  const toolCallCounts = allToolCalls.reduce<Record<ToolCall['status'], number>>(
    (acc, call) => {
      acc[call.status] += 1
      return acc
    },
    { ok: 0, error: 0, blocked: 0, confirmed: 0, rejected: 0 }
  )

  // Per-row latency meters read against the slowest run in the window.

  return (
    <div className="space-y-8">
      <RunCopilotPanel copilotId={id} copilotName={copilot.name} />

      {runs.length === 0 || !selectedRun ? (
        <div className="overflow-hidden rounded-xl bg-white px-6 py-12 ring-1 ring-zinc-950/5 dark:bg-zinc-950 dark:ring-white/10">
          <div className="mx-auto max-w-md text-center">
            <SignalIcon aria-hidden="true" className="mx-auto size-8 text-zinc-400 dark:text-zinc-600" />
            <Subheading className="mt-4">No runs yet</Subheading>
            <Text className="mt-2">
              This copilot hasn&apos;t served any production traffic. Send it a real ad hoc run from the &ldquo;Run{' '}
              {copilot.name}&rdquo; panel above to see runs, steps and tool calls here — automated test suites ship
              in V2.
            </Text>
            <div className="mt-6 flex justify-center">
              <Button outline href={`/admin/agents/${id}/tests`}>
                Go to tests
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <AgentSectionCard title="Latency" description="Per-run latency, oldest to newest.">
            <RunLatencyChart data={latencyPoints} />
          </AgentSectionCard>

          {/* Selected run: timeline dominant on the LEFT, tool-call mix on the right. */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
            <div className="lg:col-span-2">
              <RunDetailPanel
                run={selectedRun}
                steps={selectedSteps}
                toolCalls={selectedToolCalls}
                versionLabel={selectedVersion?.label}
              />
            </div>

            <AgentSectionCard title="Tool calls" description="Outcomes across the runs above.">
              {/* One mix bar (severity by fill), not five disconnected counts. */}
              {allToolCalls.length > 0 ? (
                <SplitBar
                  height="md"
                  segments={toolCallRamp
                    .map(({ status, label, tone }) => ({ key: status, label, value: toolCallCounts[status], tone }))
                    .filter((segment) => segment.value > 0)}
                  caption={`${allToolCalls.length} tool call${allToolCalls.length === 1 ? '' : 's'} across ${runs.length} run${runs.length === 1 ? '' : 's'}`}
                />
              ) : (
                <p className="text-sm text-zinc-500">No tool calls recorded across these runs.</p>
              )}
            </AgentSectionCard>
          </div>

          {/* Recent runs — FULL WIDTH below everything. No lateral scroll: run id truncates. */}
          <AgentSectionCard title="Recent runs" description="Newest first. Select a run to inspect its timeline.">
            <Table striped dense>
              <TableHead>
                <TableRow>
                  <TableHeader>Run</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Input</TableHeader>
                  <TableHeader className="text-right">Latency</TableHeader>
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
                      <TableCell className="max-w-[16rem]">
                        <span className="block truncate font-mono text-xs font-medium tabular-nums text-zinc-950 dark:text-white">
                          {run.id}
                        </span>
                        <span className="block font-mono text-xs tabular-nums text-zinc-500">
                          {formatTimestamp(run.startedAt).replace(' UTC', '')}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-zinc-500 dark:text-zinc-400">{statusLabel(run.status)}</span>
                      </TableCell>
                      <TableCell className="w-full max-w-0">
                        <span title={run.inputSummary} className="block truncate text-zinc-500 dark:text-zinc-400">
                          {run.inputSummary}
                        </span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-mono text-xs tabular-nums text-zinc-950 dark:text-white">
                        {formatDurationMs(run.latencyMs)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </AgentSectionCard>
        </>
      )}
    </div>
  )
}
