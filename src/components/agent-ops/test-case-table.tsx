import {
  ArrowPathIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  MinusCircleIcon,
  XCircleIcon,
} from '@heroicons/react/20/solid'
import clsx from 'clsx'

import { EmptyState } from '@/components/agent-ops/empty-state'
import { surfaceCardClass, surfaceCardHeaderClass } from '@/components/agent-ops/surface-card'
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

export function TestCaseTable({
  cases,
  resultsByCase,
}: {
  cases: TestCase[]
  resultsByCase: Record<string, TestResult | undefined>
}) {
  if (cases.length === 0) {
    return (
      <div className={surfaceCardClass}>
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
          <TableRow className={surfaceCardHeaderClass}>
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
            const showFailure =
              result != null &&
              (result.status === 'fail' || result.status === 'error') &&
              result.failureReason != null
            const [firstTool, ...restTools] = testCase.expectedToolCalls

            return (
              <TableRow key={testCase.id} className="hover:bg-white/2.5">
                <TableCell>
                  <span className="block max-w-[12rem] truncate text-sm font-medium text-white" title={testCase.name}>
                    {testCase.name}
                  </span>
                </TableCell>
                <TableCell>
                  {result ? (
                    <div className="flex items-center gap-2">
                      <ResultIcon status={result.status} />
                      <span className={clsx('text-xs font-medium', resultTextClass[result.status])}>
                        {resultLabel[result.status]}
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
                  {result ? (
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
                    <span className="block max-w-[11rem] truncate text-xs text-accent-400" title={result.failureReason!}>
                      {result.failureReason}
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
