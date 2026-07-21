import { SignalIcon, BoltIcon, ExclamationTriangleIcon, CheckCircleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { EmptyStatePanel } from '@/components/agent-ops/empty-state'
import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'
import { COST_ESTIMATE_TOOLTIP, RunDetailPanel, RunModelValue } from '@/components/agent-ops/run-detail-panel'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { SplitBar, type SplitTone } from '@/components/agent-ops/widgets/split-bar'
import { formatDurationMs, formatTimestamp, formatUsd } from '@/lib/agent-mission-control/format'
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
import { Button } from '@/components/catalyst/button'
import { Subheading } from '@/components/catalyst/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'

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

function RunStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'completed': return <CheckCircleIcon aria-hidden="true" className="size-4 text-accent-400" />
    case 'failed': return <ExclamationTriangleIcon aria-hidden="true" className="size-4 text-accent-400" />
    case 'blocked': return <PauseCircleIcon aria-hidden="true" className="size-4 text-accent-400" />
    default: return <BoltIcon aria-hidden="true" className="size-4 text-zinc-500" />
  }
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

  return (
    <div className="space-y-8 pb-12">
      <RunCopilotPanel copilotId={id} copilotName={copilot.name} copilotSlug={copilot.slug} copilotTags={copilot.tags} />

      {runs.length === 0 || !selectedRun ? (
        <EmptyStatePanel
          icon={SignalIcon}
          title="No runs yet"
          description={`This copilot hasn't served any production traffic. Send it a real ad hoc run from the "Run ${copilot.name}" panel above.`}
          action={
            <Button outline href={`/admin/agents/${id}/tests`}>
              Go to tests
            </Button>
          }
          className="py-24"
        />
      ) : (
        <>
          <div className="flex flex-col gap-4">
            <div>
              <Subheading level={2} tone="neutral" className="tracking-tight text-white">Run Latency</Subheading>
              <p className="mt-1 text-sm text-zinc-400">Performance trend over the last {runs.length} runs</p>
            </div>
            <div className="py-2">
              <RunLatencyChart data={latencyPoints} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-16 lg:grid-cols-3 lg:items-start pt-16 border-t border-white/[0.04]">
            <div className="lg:col-span-2">
              <RunDetailPanel
                run={selectedRun}
                steps={selectedSteps}
                toolCalls={selectedToolCalls}
                versionLabel={selectedVersion?.label}
                declaredModel={copilot.model}
              />
            </div>

            <div className="flex flex-col gap-6">
              <div>
                <Subheading level={2} tone="neutral" className="tracking-tight text-white">Tool Calls</Subheading>
                <p className="mt-1 text-sm text-zinc-400">Outcomes across {runs.length} runs</p>
              </div>
              <div>
                {allToolCalls.length > 0 ? (
                  <div className="flex flex-col gap-6">
                    <SplitBar
                      height="md"
                      segments={toolCallRamp
                        .map(({ status, label, tone }) => ({ key: status, label, value: toolCallCounts[status], tone }))
                        .filter((segment) => segment.value > 0)}
                      caption={`${allToolCalls.length} total tool calls`}
                    />
                    <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
                      {toolCallRamp.map(({ status, label }) => {
                        const count = toolCallCounts[status]
                        if (count === 0) return null
                        return (
                          <div key={status} className="flex flex-col gap-1 border-t border-white/5 pt-3">
                            <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>
                            <span className="font-mono text-lg font-light tabular-nums text-white">{count}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-zinc-500">No tool calls recorded across these runs.</p>
                )}
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 pt-16 border-t border-white/[0.04]">
            <div className="flex items-baseline gap-4">
              <Subheading level={2} tone="neutral" className="tracking-tight text-white">Recent Runs</Subheading>
              <span className="font-mono text-xs tabular-nums text-zinc-500">{runs.length} total</span>
            </div>
            <div className="-mx-6">
              <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Run ID & Time</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Model</TableHeader>
                  <TableHeader>Input Summary</TableHeader>
                  <TableHeader className="text-right">
                    <span className="cursor-help" title={COST_ESTIMATE_TOOLTIP}>
                      Cost · est.
                    </span>
                  </TableHeader>
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
                      title={`View run ${run.id}`}
                      className={clsx(
                        selected
                          ? 'bg-[var(--color-surface-interactive)] ring-1 ring-inset ring-[var(--accent-line-strong)]'
                          : ''
                      )}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-mono text-xs font-medium text-white">
                            {run.id}
                          </span>
                          <span className="font-mono text-[10px] text-zinc-500 mt-0.5">
                            {formatTimestamp(run.startedAt).replace(' UTC', '')}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <RunStatusIcon status={run.status} />
                          <span className={clsx(
                            "text-xs font-medium",
                            run.status === 'completed' ? "text-zinc-300" : "text-accent-400"
                          )}>
                            {statusLabel(run.status)}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="block max-w-[12rem] truncate font-mono text-xs text-zinc-300">
                          <RunModelValue run={run} declaredModel={copilot.model} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="block text-xs text-zinc-400 truncate max-w-md" title={run.inputSummary}>
                          {run.inputSummary}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs font-mono text-zinc-400">{formatUsd(run.costUsd)}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className="text-xs font-mono text-zinc-300">{formatDurationMs(run.latencyMs)}</span>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
