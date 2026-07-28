import { Link } from '@/components/ui/link'
import type { RunRowModel } from '@/components/aigent-v2/runs/run-row-model'

/**
 * Three distinct project states, rendered as three distinct things — shared by
 * the table and the mobile cards so one surface cannot quietly lose the
 * distinction:
 *
 *   1. no project at all              -> "—"
 *   2. project id present, name read  -> the linked name
 *   3. project id present, name NOT read (degraded catalogue) -> the raw id,
 *      in mono, still linked, with a title saying why
 *
 * Collapsing 3 into 1 is what turns "we could not read this" into "there is
 * none", which is the failure the partial-data contract exists to prevent.
 */
export function ProjectCell({ row, className = '' }: { row: RunRowModel; className?: string }) {
  if (!row.projectId || !row.projectHref) {
    return <span className={`text-zinc-400 ${className}`}>—</span>
  }

  if (!row.projectNameResolved) {
    return (
      <Link
        href={row.projectHref}
        title="Project name unavailable — showing id"
        className={`block truncate font-mono text-xs text-zinc-400 hover:underline ${className}`}
      >
        {row.projectId}
      </Link>
    )
  }

  return (
    <Link
      href={row.projectHref}
      title={row.projectName ?? undefined}
      className={`block truncate text-zinc-300 hover:underline ${className}`}
    >
      {row.projectName}
    </Link>
  )
}
