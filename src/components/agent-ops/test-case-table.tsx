import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { TestResultBadge } from '@/components/agent-ops/test-result-badge'
import { Badge } from '@/components/catalyst/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { TestCase, TestResult } from '@/lib/agent-mission-control/types'

/**
 * Test case table — one row per case, joined with the result of the suite's
 * most recent run (if any). Server-safe: no client interactivity.
 */
export function TestCaseTable({
  cases,
  resultsByCase,
}: {
  cases: TestCase[]
  resultsByCase: Record<string, TestResult | undefined>
}) {
  if (cases.length === 0) {
    return <p className="text-sm text-zinc-500">No test cases in this suite yet.</p>
  }

  return (
    <Table dense bleed className="[--gutter:--spacing(6)]">
      <TableHead>
        <TableRow>
          <TableHeader>Case</TableHeader>
          <TableHeader>Result</TableHeader>
          <TableHeader>Input</TableHeader>
          <TableHeader>Expected</TableHeader>
          <TableHeader>Tools</TableHeader>
          <TableHeader>
            Latency<span className="sr-only"> and cost</span>
          </TableHeader>
          <TableHeader>Failure</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {cases.map((testCase) => {
          const result = resultsByCase[testCase.id]
          const showFailure =
            result != null && (result.status === 'fail' || result.status === 'error') && result.failureReason != null
          const [firstTool, ...restTools] = testCase.expectedToolCalls

          return (
            <TableRow key={testCase.id}>
              <TableCell>
                <p className="font-medium text-zinc-950 dark:text-white">{testCase.name}</p>
                {testCase.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {testCase.tags.map((tag) => (
                      <span
                        key={tag}
                        className="inline-flex items-center rounded-md bg-zinc-950/5 px-1.5 py-0.5 font-mono text-xs text-zinc-500 ring-1 ring-zinc-950/10 dark:bg-white/5 dark:text-zinc-400 dark:ring-white/10"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                {result ? <TestResultBadge result={result.status} /> : <Badge color="zinc">Not run</Badge>}
              </TableCell>
              <TableCell>
                <p className="max-w-56 truncate text-zinc-500 dark:text-zinc-400" title={testCase.input}>
                  {testCase.input}
                </p>
              </TableCell>
              <TableCell>
                <p className="max-w-64 truncate text-zinc-500 dark:text-zinc-400" title={testCase.expectedBehavior}>
                  {testCase.expectedBehavior}
                </p>
              </TableCell>
              <TableCell>
                {firstTool ? (
                  <div className="flex items-center gap-1" title={testCase.expectedToolCalls.join(', ')}>
                    <ToolBadge name={firstTool} />
                    {restTools.length > 0 ? (
                      <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                        +{restTools.length}
                      </span>
                    ) : null}
                    {restTools.length > 0 ? <span className="sr-only">{restTools.join(', ')}</span> : null}
                  </div>
                ) : (
                  <span className="text-xs text-zinc-500">none</span>
                )}
              </TableCell>
              <TableCell>
                {result ? (
                  <span className="font-mono text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatDurationMs(result.latencyMs)} · {formatUsd(result.costUsd, 3)}
                  </span>
                ) : (
                  <>
                    <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                      —
                    </span>
                    <span className="sr-only">No measurement</span>
                  </>
                )}
              </TableCell>
              <TableCell>
                {showFailure ? (
                  <p className="max-w-64 truncate text-xs text-accent-600 dark:text-accent-400" title={result.failureReason ?? undefined}>
                    {result.failureReason}
                  </p>
                ) : (
                  <>
                    <span aria-hidden="true" className="text-zinc-400 dark:text-zinc-600">
                      —
                    </span>
                    <span className="sr-only">No failure</span>
                  </>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
