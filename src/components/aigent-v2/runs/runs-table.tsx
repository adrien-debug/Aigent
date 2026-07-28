import { ModelCell } from '@/components/aigent-v2/runs/model-cell'
import { ProjectCell } from '@/components/aigent-v2/runs/project-cell'
import type { RunRowModel } from '@/components/aigent-v2/runs/run-row-model'
import { RunStatusBadge } from '@/components/aigent-v2/runs/status-badge'
import { Link } from '@/components/ui/link'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/**
 * Per-column responsive visibility. Header and cell read the SAME constant, so
 * a column cannot become visible in one and hidden in the other (that drift is
 * how a table ends up with a header row offset from its data).
 *
 * The mission's minimum column set — run/agent, project, status, model,
 * latency, cost, started, trace — is visible at EVERY width. `Tools` and
 * `Input` are additive: the feed lives in a 2/3 column above 1400px, and
 * eleven columns there produced a horizontal scrollbar with the last five off
 * screen. Search already covers input text.
 */
const COL_EXTRA = 'hidden 2xl:table-cell'

/**
 * Run id and agent share ONE column — the mission names that minimum column
 * "run/agent", and the two identify the same thing to an operator scanning the
 * feed. Splitting them cost ~70px the panel does not have.
 */
const HEADERS: { label: string; className?: string }[] = [
  { label: 'Run / agent' },
  { label: 'Project' },
  { label: 'Status' },
  { label: 'Input', className: COL_EXTRA },
  { label: 'Model' },
  { label: 'Tools', className: COL_EXTRA },
  { label: 'Latency' },
  { label: 'Cost' },
  { label: 'Started (UTC)' },
  { label: 'Trace' },
]

export function RunsTable({ rows }: { rows: RunRowModel[] }) {
  return (
    // `lg` and up only — below that the same rows render as stacked cards
    // (RunsCardList) with the same fields and actions, because a ten-column
    // table on a 375px screen is a horizontal scroll nobody reads.
    <div className="hidden lg:block">
      <Table dense bleed caption="Operational runs across all agents and projects">
        <TableHead>
          <TableRow>
            {HEADERS.map((header) => (
              <TableHeader key={header.label} className={header.className}>
                {header.label}
              </TableHeader>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="max-w-44">
                <Link
                  href={row.agentHref}
                  className={`block truncate hover:underline ${row.agentNameResolved ? 'text-white' : 'font-mono text-xs text-zinc-400'}`}
                  title={row.agentNameResolved ? row.agentName : 'Agent name unavailable — showing id'}
                >
                  {row.agentName}
                </Link>
                <Link
                  href={row.detailHref}
                  className="mt-0.5 block font-mono text-[11px] text-zinc-400 hover:underline"
                >
                  {row.shortId}
                </Link>
              </TableCell>
              <TableCell className="max-w-36">
                <ProjectCell row={row} />
              </TableCell>
              <TableCell>
                <RunStatusBadge status={row.status} />
              </TableCell>
              <TableCell className={`${COL_EXTRA} max-w-72`}>
                {row.inputSummary ? (
                  <span className="block truncate text-zinc-400" title={row.inputSummary}>
                    {row.inputSummary}
                  </span>
                ) : (
                  <span className="text-zinc-400">—</span>
                )}
              </TableCell>
              <TableCell>
                <ModelCell row={row} />
              </TableCell>
              <TableCell className={`${COL_EXTRA} tabular-nums`}>
                {row.toolCallCount}
                {row.unsafeAttemptCount > 0 ? (
                  <span className="ml-1.5 text-[var(--state-danger-text)]">
                    +{row.unsafeAttemptCount} unsafe
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="tabular-nums">
                {row.duration ?? <span className="text-zinc-400">—</span>}
              </TableCell>
              <TableCell className="tabular-nums">
                {row.cost ?? <span className="text-zinc-400">Not measured</span>}
              </TableCell>
              <TableCell className="text-zinc-400">
                <time dateTime={row.startedAtIso}>{row.startedAtLabel}</time>
              </TableCell>
              <TableCell>
                {row.traceUrl ? (
                  <Link href={row.traceUrl} target="_blank" rel="noreferrer" className="hover:underline">
                    Trace
                  </Link>
                ) : (
                  <Link href={row.detailHref} className="text-zinc-400 hover:underline">
                    Detail
                  </Link>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
