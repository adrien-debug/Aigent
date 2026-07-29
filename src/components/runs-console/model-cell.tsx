import { Badge } from '@/components/ui/badge'
import type { RunRowModel } from '@/components/runs-console/run-row-model'

/**
 * Model/provider as the runner actually RESOLVED it, shared by the table and
 * the mobile cards so the "unverified" disclosure cannot exist on one surface
 * and be dropped on the other.
 *
 * "Unverified" is not a failure, so it does not wear the danger role: it is an
 * absence of proof, which the zinc badge states plainly.
 *
 * Inline `<span>`s rather than `<Text>` — `Text` renders a block `<p>`, and
 * this sits inside a table cell next to a badge.
 */
export function ModelCell({ row }: { row: RunRowModel }) {
  if (!row.model) {
    return (
      <Badge color="zinc" title="The runner never proved a model for this run">
        Unverified
      </Badge>
    )
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span className={row.modelVerified ? 'text-zinc-200' : 'text-zinc-400'}>
        {row.model}
        {row.provider ? (
          // The provider is secondary — dropped below 2xl so the column fits
          // the feed panel without a horizontal scrollbar.
          <span className="hidden text-zinc-400 2xl:inline"> · {row.provider}</span>
        ) : null}
      </span>
      {!row.modelVerified ? (
        <Badge color="zinc" title="Recorded, but the runner never proved it">
          Unverified
        </Badge>
      ) : null}
    </span>
  )
}
