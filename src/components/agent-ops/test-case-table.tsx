'use client'

import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { surfaceCardClass } from '@/components/agent-ops/surface-card'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { TestCase, TestResult, TestResultStatus } from '@/lib/agent-mission-control/types'
import { BeakerIcon } from '@heroicons/react/24/outline'

const resultLabel: Record<TestResultStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  skip: 'Skip',
  running: 'Running',
}

/**
 * Result semantics are carried by the LABEL + an accent-intensity nuance —
 * never by a green/red hue (doctrine: one chromatic teinte, accent). Pass reads
 * as a soft accent, fail/error escalate to solid accent, skip/running stay zinc.
 */
const resultIconClass: Record<TestResultStatus, string> = {
  pass: 'text-accent-400',
  fail: 'text-accent-600',
  error: 'text-accent-500',
  running: 'text-zinc-400 animate-spin',
  skip: 'text-zinc-600',
}

const resultTextClass: Record<TestResultStatus, string> = {
  pass: 'text-accent-300',
  fail: 'text-accent-400',
  error: 'text-accent-400',
  running: 'text-zinc-400',
  skip: 'text-zinc-500',
}

function ResultIcon({ status }: { status: TestResultStatus }) {
  const className = clsx('size-4 shrink-0', resultIconClass[status])
  switch (status) {
    case 'pass':
      return <CheckCircleIcon aria-hidden="true" className={className} />
    case 'fail':
      return <XCircleIcon aria-hidden="true" className={className} />
    case 'error':
      return <ExclamationTriangleIcon aria-hidden="true" className={className} />
    case 'running':
      return <ArrowPathIcon aria-hidden="true" className={className} />
    case 'skip':
    default:
      return <MinusCircleIcon aria-hidden="true" className={className} />
  }
}

/**
 * Live per-case override, driven by the run stream while `LiveTestRunPanel` runs
 * a suite. `status` is a strict subset of `TestResultStatus` (no `skip` — a live
 * case is `running` then pass/fail/error). `failureReason` is only carried by the
 * stream's `case-completed` frame; latency/cost are NOT available live (they are
 * persisted, read back on refresh) so those columns stay `—` during a run.
 */
export type LiveCaseState = {
  status: 'running' | 'pass' | 'fail' | 'error'
  failureReason: string | null
}

/**
 * The cases table for a suite. Server-driven by default (`resultsByCase` = the
 * last persisted run). When `liveByCase` is supplied (only `LiveTestRunPanel`
 * passes it, and only while a run is streaming), each entry OVERRIDES that case's
 * Result + Failure columns with the live verdict — the table resets and fills in
 * running→pass/fail in real time. A case absent from `liveByCase` during a live
 * run reads as `—` (its turn hasn't come, or the run just reset). When the run
 * ends, the panel clears `liveByCase` and `router.refresh()` reloads the same
 * verdicts from the persisted `resultsByCase`, so the display is seamless.
 */
export function TestCaseTable({
  cases,
  resultsByCase,
  liveByCase,
}: {
  cases: TestCase[]
  resultsByCase: Record<string, TestResult | undefined>
  /** Present only during a live run (from `LiveTestRunPanel`); overrides results. */
  liveByCase?: Record<string, LiveCaseState | undefined>
}) {
  if (cases.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-white/5 bg-white/[0.01]">
        <EmptyState
          icon={BeakerIcon}
          title="No test cases yet"
          description="This suite has no test cases. Add cases to evaluate this copilot's behavior."
        />
      </div>
    )
  }

  return (
    <div className={surfaceCardClass}>
      {/* Table padded to the card's px-6 gutter (no bleed) so header + body
          columns stay aligned to the card edge. */}
      <Table dense className="px-6 [--gutter:--spacing(0)]">
        <TableHead>
          <TableRow>
            <TableHeader>Case</TableHeader>
            <TableHeader>Result</TableHeader>
            <TableHeader>Input</TableHeader>
            <TableHeader>Tools</TableHeader>
            <TableHeader className="text-right">Latency</TableHeader>
            <TableHeader>Failure</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>
          {cases.map((testCase) => {
            const result = resultsByCase[testCase.id]
            // A live run OVERRIDES the persisted result: while `liveByCase` is
            // present the Result/Failure columns follow the stream, and Latency
            // (persisted-only) shows `—` until the refresh. `isLive` gates the
            // whole run so a reset (all cases dropped from the map) blanks every
            // Result cell, not just the ones already started.
            const isLive = liveByCase != null
            const live = liveByCase?.[testCase.id]
            const effectiveStatus: TestResultStatus | null = isLive
              ? (live?.status ?? null)
              : (result?.status ?? null)
            const effectiveFailure: string | null = isLive
              ? (live?.failureReason ?? null)
              : (result?.failureReason ?? null)
            const showFailure =
              (effectiveStatus === 'fail' || effectiveStatus === 'error') && effectiveFailure != null
            // Latency/cost are persisted-only — never available mid-run.
            const showTiming = !isLive && result != null
            const [firstTool, ...restTools] = testCase.expectedToolCalls

            return (
              <TableRow key={testCase.id} className="hover:bg-white/2.5">
                <TableCell>
                  <span className="block max-w-[12rem] truncate text-sm font-medium text-white" title={testCase.name}>
                    {testCase.name}
                  </span>
                </TableCell>
                <TableCell>
                  {effectiveStatus ? (
                    <div className="flex items-center gap-2">
                      <ResultIcon status={effectiveStatus} />
                      <span className={clsx('text-xs font-medium', resultTextClass[effectiveStatus])}>
                        {resultLabel[effectiveStatus]}
                      </span>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="block max-w-[13rem] truncate text-xs text-zinc-400" title={testCase.input}>
                    {testCase.input}
                  </span>
                </TableCell>
                <TableCell>
                  {firstTool ? (
                    <div className="flex items-center gap-1.5">
                      <ToolBadge name={firstTool} />
                      {restTools.length > 0 && (
                        <span className="text-xs font-medium text-zinc-500">+{restTools.length}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {showTiming && result ? (
                    <div className="flex flex-col items-end">
                      <span className="font-mono text-xs text-zinc-300 tabular-nums">
                        {formatDurationMs(result.latencyMs)}
                      </span>
                      <span className="font-mono text-xs text-zinc-500 tabular-nums">{formatUsd(result.costUsd)}</span>
                    </div>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
                <TableCell>
                  {showFailure ? (
                    <span className="block max-w-[11rem] truncate text-xs text-accent-400" title={effectiveFailure!}>
                      {effectiveFailure}
                    </span>
                  ) : (
                    <span className="text-xs text-zinc-600">—</span>
                  )}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
