import { EmptyState } from '@/components/agent-ops/empty-state'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import type { ReplayCandidate, ReplayStepDiff } from '@/lib/agent-mission-control/types'

const verdictLabels: Record<ReplayStepDiff['verdict'], string> = {
  match: 'Match',
  'acceptable-diff': 'Acceptable diff',
  divergence: 'Divergence',
  unsafe: 'Unsafe',
}

/**
 * Verdict semantics are carried by the LABEL + an accent-intensity nuance —
 * never by a green/red hue (doctrine shared with TestCaseTable's resultTextClass).
 * Match reads as a soft accent, diff/divergence/unsafe escalate.
 */
const verdictToneClass: Record<ReplayStepDiff['verdict'], string> = {
  match: 'text-accent-500 dark:text-accent-400',
  'acceptable-diff': 'text-zinc-500 dark:text-zinc-400',
  divergence: 'text-accent-600 dark:text-accent-500',
  unsafe: 'text-accent-700 dark:text-accent-600 font-medium',
}

/**
 * Expected vs actual behavior, per replayed step, for one candidate.
 * Server-safe: pure Catalyst table, no state, no effects.
 */
export function ReplayComparisonTable({ candidate }: { candidate: ReplayCandidate }) {
  if (candidate.steps.length === 0) {
    return <EmptyState title="No step diffs yet" description="This candidate is still pending replay." />
  }

  return (
    <Table striped className="[--gutter:--spacing(4)]">
      <TableHead>
        <TableRow>
          <TableHeader className="w-0 text-right">Step</TableHeader>
          <TableHeader>Expected</TableHeader>
          <TableHeader>Actual</TableHeader>
          <TableHeader>Verdict</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {candidate.steps.map((step) => {
          const verdictLabel = verdictLabels[step.verdict]
          return (
            <TableRow key={step.stepIndex}>
              <TableCell className="align-top text-right font-mono text-xs tabular-nums text-zinc-500">
                #{step.stepIndex}
              </TableCell>
              <TableCell className="min-w-48 align-top whitespace-normal text-zinc-500 dark:text-zinc-400">{step.expected}</TableCell>
              <TableCell className="min-w-48 align-top whitespace-normal text-zinc-700 dark:text-zinc-300">{step.actual}</TableCell>
              <TableCell className="align-top">
                <span className={verdictToneClass[step.verdict]}>{verdictLabel}</span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
