import { Badge } from '@/components/catalyst/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/catalyst/table'
import { Text } from '@/components/catalyst/text'
import type { ReplayCandidate, ReplayStepDiff } from '@/lib/agent-mission-control/types'

const verdictConfig: Record<ReplayStepDiff['verdict'], { label: string; color: 'accent' | 'zinc' | 'accentStrong' | 'accentSolid' }> = {
  match: { label: 'Match', color: 'accent' },
  'acceptable-diff': { label: 'Acceptable diff', color: 'zinc' },
  divergence: { label: 'Divergence', color: 'accentStrong' },
  unsafe: { label: 'Unsafe', color: 'accentSolid' },
}

/**
 * Expected vs actual behavior, per replayed step, for one candidate.
 * Server-safe: pure Catalyst table, no state, no effects.
 */
export function ReplayComparisonTable({ candidate }: { candidate: ReplayCandidate }) {
  if (candidate.steps.length === 0) {
    return <Text className="py-4">No step diffs recorded yet — this candidate is still pending.</Text>
  }

  return (
    <Table className="[--gutter:--spacing(4)]">
      <TableHead>
        <TableRow>
          <TableHeader className="w-0">Step</TableHeader>
          <TableHeader>Expected</TableHeader>
          <TableHeader>Actual</TableHeader>
          <TableHeader>Verdict</TableHeader>
        </TableRow>
      </TableHead>
      <TableBody>
        {candidate.steps.map((step) => {
          const verdict = verdictConfig[step.verdict]
          return (
            <TableRow key={step.stepIndex}>
              <TableCell className="align-top font-mono text-xs tabular-nums text-zinc-500">
                #{step.stepIndex}
              </TableCell>
              <TableCell className="min-w-48 align-top whitespace-normal text-zinc-500 dark:text-zinc-400">{step.expected}</TableCell>
              <TableCell className="min-w-48 align-top whitespace-normal text-zinc-700 dark:text-zinc-300">{step.actual}</TableCell>
              <TableCell className="align-top">
                <Badge color={verdict.color}>{verdict.label}</Badge>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
