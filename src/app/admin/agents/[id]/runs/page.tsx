import { SignalIcon, BoltIcon, ExclamationTriangleIcon, CheckCircleIcon, PauseCircleIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'
import { notFound } from 'next/navigation'

import { RunCopilotPanel } from '@/components/agent-ops/run-copilot-panel'
import { RunDetailPanel } from '@/components/agent-ops/run-detail-panel'
import { RunLatencyChart } from '@/components/agent-ops/run-latency-chart'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'
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
import { Link } from '@/components/catalyst/link'
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
    case 'completed': return <CheckCircleIcon className="size-4 text-accent-400" />
    case 'failed': return <ExclamationTriangleIcon className="size-4 text-accent-400" />
    case 'blocked': return <PauseCircleIcon className="size-4 text-accent-400" />
    default: return <BoltIcon className="size-4 text-zinc-500" />
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
        <div className="flex flex-col items-center justify-center py-24 rounded-2xl border border-white/5 border-dashed bg-white/[0.01]">
          <SignalIcon className="size-12 text-zinc-700 mb-4" />
          <h3 className="text-sm font-medium text-white">No runs yet</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-md text-center">
            This copilot hasn&apos;t served any production traffic. Send it a real ad hoc run from the &quot;Run {copilot.name}&quot; panel above.
          </p>
          <div className="mt-6">
            <Link href={`/admin/agents/${id}/tests`} className="inline-flex items-center gap-2 rounded-lg bg-white/5 px-4 py-2 text-sm font-medium text-white hover:bg-white/10 transition-colors">
              Go to tests
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className={surfaceCardClass}>
            <div className="flex items-center justify-between p-6 border-b border-white/5">
              <div>
                <h2 className="text-sm font-semibold text-white">Run Latency</h2>
                <p className="text-xs text-zinc-400 mt-1">Performance trend over the last {runs.length} runs</p>
              </div>
            </div>
            <div className="p-6 bg-[var(--color-surface-primary)]/30">
              <RunLatencyChart data={latencyPoints} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-start">
            <div className="lg:col-span-2">
              <RunDetailPanel
                run={selectedRun}
                steps={selectedSteps}
                toolCalls={selectedToolCalls}
                versionLabel={selectedVersion?.label}
              />
            </div>

            <div className="flex flex-col gap-6">
              <div className={surfaceCardClass}>
                <div className="p-6 border-b border-white/5">
                  <h2 className="text-sm font-semibold text-white">Tool Calls Overview</h2>
                  <p className="text-xs text-zinc-400 mt-1">Outcomes across {runs.length} runs</p>
                </div>
                <div className="p-6">
                  {allToolCalls.length > 0 ? (
                    <div className="flex flex-col gap-6">
                      <SplitBar
                        height="md"
                        segments={toolCallRamp
                          .map(({ status, label, tone }) => ({ key: status, label, value: toolCallCounts[status], tone }))
                          .filter((segment) => segment.value > 0)}
                        caption={`${allToolCalls.length} total tool calls`}
                      />
                      <div className="grid grid-cols-2 gap-4">
                        {toolCallRamp.map(({ status, label }) => {
                          const count = toolCallCounts[status]
                          if (count === 0) return null
                          return (
                            <div key={status} className="flex flex-col gap-1 p-3 rounded-lg bg-black/20 border border-white/5">
                              <span className="text-[10px] uppercase tracking-widest text-zinc-500">{label}</span>
                              <span className="text-lg font-light text-white">{count}</span>
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
          </div>

          <div className={surfaceCardClass}>
            <div className="flex items-center justify-between p-4 border-b border-white/5 bg-black/20">
              <h2 className="text-sm font-semibold text-white">Recent Runs</h2>
              <span className="text-xs text-zinc-500">{runs.length} runs</span>
            </div>
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeader>Run ID & Time</TableHeader>
                  <TableHeader>Status</TableHeader>
                  <TableHeader>Input Summary</TableHeader>
                  <TableHeader className="text-right">Cost</TableHeader>
                  <TableHeader className="text-right">Latency</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>
                {runs.map((run) => {
                  const selected = run.id === selectedRun.id
                  return (
                    <TableRow
                      key={run.id}
                      className={clsx(
                        selected ? "bg-[var(--color-surface-interactive)] ring-1 ring-inset ring-accent-500/50" : ""
                      )}
                    >
                      <TableCell>
                        <div className="flex flex-col">
                          <Link href={`/admin/agents/${id}/runs?run=${run.id}`} className="font-mono text-xs font-medium text-white group-hover:underline">
                            {run.id}
                          </Link>
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
        </>
      )}
    </div>
  )
}
