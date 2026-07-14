import { SurfaceCard } from '@/components/agent-ops/surface-card'
import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { TestCase, TestResult, TestResultStatus } from '@/lib/agent-mission-control/types'
import { CheckCircleIcon, ExclamationTriangleIcon, XCircleIcon, MinusCircleIcon, ArrowPathIcon } from '@heroicons/react/20/solid'
import clsx from 'clsx'

const resultLabel: Record<TestResultStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  skip: 'Skip',
  running: 'Running',
}

function ResultIcon({ status }: { status: TestResultStatus }) {
  switch (status) {
    case 'pass': return <CheckCircleIcon className="size-4 text-emerald-400" />
    case 'fail': return <XCircleIcon className="size-4 text-red-400" />
    case 'error': return <ExclamationTriangleIcon className="size-4 text-accent-400" />
    case 'running': return <ArrowPathIcon className="size-4 text-zinc-400 animate-spin" />
    case 'skip':
    default: return <MinusCircleIcon className="size-4 text-zinc-600" />
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
      <div className="flex flex-col items-center justify-center py-16 rounded-2xl border border-white/5 border-dashed bg-white/[0.01]">
        <p className="text-sm text-zinc-500">No test cases in this suite yet.</p>
      </div>
    )
  }

  return (
    <SurfaceCard>
      <div className="overflow-x-auto no-scrollbar">
        <Table className="w-full text-left border-collapse min-w-[1000px]">
          <TableHead>
            <TableRow className="border-b border-white/5 bg-black/40">
              <TableHeader>Case</TableHeader>
              <TableHeader>Result</TableHeader>
              <TableHeader className="w-1/3">Input</TableHeader>
              <TableHeader>Tools</TableHeader>
              <TableHeader className="text-right">Latency</TableHeader>
              <TableHeader>Failure</TableHeader>
            </TableRow>
          </TableHead>
          <TableBody className="divide-y divide-white/5">
            {cases.map((testCase) => {
              const result = resultsByCase[testCase.id]
              const showFailure = result != null && (result.status === 'fail' || result.status === 'error') && result.failureReason != null
              const [firstTool, ...restTools] = testCase.expectedToolCalls

              return (
                <TableRow key={testCase.id} className="group hover:bg-[var(--color-surface-interactive)] transition-colors">
                  <TableCell className="py-3 px-6">
                    <span className="text-sm font-medium text-white">{testCase.name}</span>
                  </TableCell>
                  <TableCell className="py-3 px-6">
                    {result ? (
                      <div className="flex items-center gap-2">
                        <ResultIcon status={result.status} />
                        <span className={clsx(
                          "text-xs font-medium",
                          result.status === 'pass' ? "text-emerald-400" : result.status === 'fail' ? "text-red-400" : result.status === 'error' ? "text-accent-400" : "text-zinc-400"
                        )}>
                          {resultLabel[result.status]}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 px-6">
                    <span className="block text-xs text-zinc-400 truncate max-w-md" title={testCase.input}>
                      {testCase.input}
                    </span>
                  </TableCell>
                  <TableCell className="py-3 px-6">
                    {firstTool ? (
                      <div className="flex items-center gap-1.5">
                        <ToolBadge name={firstTool} />
                        {restTools.length > 0 && (
                          <span className="text-[10px] font-medium text-zinc-500">+{restTools.length}</span>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 px-6 text-right">
                    {result ? (
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-mono text-zinc-300">{formatDurationMs(result.latencyMs)}</span>
                        <span className="text-[10px] font-mono text-zinc-500">{formatUsd(result.costUsd)}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell className="py-3 px-6">
                    {showFailure ? (
                      <span className="block text-xs text-red-400 truncate max-w-[200px]" title={result.failureReason!}>
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
    </SurfaceCard>
  )
}
