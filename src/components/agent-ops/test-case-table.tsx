import { ToolBadge } from '@/components/agent-ops/tool-badge'
import { Badge } from '@/components/catalyst/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { formatDurationMs, formatUsd } from '@/lib/agent-mission-control/format'
import type { TestCase, TestResult, TestResultStatus } from '@/lib/agent-mission-control/types'

const resultLabel: Record<TestResultStatus, string> = {
  pass: 'Pass',
  fail: 'Fail',
  error: 'Error',
  skip: 'Skip',
  running: 'Running',
}

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
    <Table striped dense bleed className="[--gutter:--spacing(6)]">
      <TableHead>
        <TableRow>
          <TableHeader>Case</TableHeader>
          <TableHeader>Result</TableHeader>
          <TableHeader>Input</TableHeader>
          <TableHeader>Tools</TableHeader>
          <TableHeader className="text-right">
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
                {testCase.expectedBehavior ? (
                  <p
                    className="mt-1 max-w-xs truncate text-xs text-zinc-500 dark:text-zinc-400"
                    title={testCase.expectedBehavior}
                  >
                    Expects: {testCase.expectedBehavior}
                  </p>
                ) : null}
                {testCase.tags.length > 0 ? (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {testCase.tags.map((tag) => (
                      <Badge key={tag} color="zinc" className="font-mono">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </TableCell>
              <TableCell>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {result ? resultLabel[result.status] : 'Not run'}
                </span>
              </TableCell>
              <TableCell>
                <p className="max-w-56 truncate text-zinc-500 dark:text-zinc-400" title={testCase.input}>
                  {testCase.input}
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
              <TableCell className="text-right">
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
