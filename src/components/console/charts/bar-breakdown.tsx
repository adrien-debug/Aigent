/**
 * `BarBreakdown` — a horizontal bar list over a CATEGORICAL split (lifecycle,
 * runtime status, executability, provider, model, tool coverage, proof
 * freshness). One row per category, each a label + a tabular count + a track
 * filled to that category's share of the total.
 *
 * NOT A SPARKLINE. A sparkline plots a SERIES over time inline in a card or a
 * table row — banned in this console. This plots the CURRENT distribution of a
 * finite set of agents across a finite set of buckets, in its own panel, never
 * embedded inside a card or a table cell. `ArcGauge`'s docblock draws the same
 * line for a single ratio; this is the same refusal for an N-way split.
 *
 * PURE SERVER-RENDERED MARKUP, like every chart in this console: no dependency,
 * no DOM measurement, no animation. It also works from a client component
 * (`agents-screen.tsx` is one, for its search/filter/sort state) — nothing here
 * needs `'use client'` itself, so it stays a plain function.
 *
 * TRUTH. `rows` is the FULL, already-computed distribution — every bucket a
 * caller found, in the order it wants them shown. This component does not
 * invent a bucket, does not drop a zero-count one (a zero row is a MEASURED
 * zero and stays visible), and never infers a total: `total` is passed in
 * explicitly so a filtered distribution cannot silently claim to cover 100% of
 * the fleet when it only covers a subset.
 */

export interface BarBreakdownRow {
  /** Bucket label, already display-ready (a raw enum value, or `Indisponible`). */
  label: string
  count: number
  /** Paints this row's track in the danger role instead of the neutral one —
   *  reserve for a genuine fault bucket (e.g. "degraded"), never for an
   *  ordinary state like "draft" or "archived". */
  danger?: boolean
}

export function BarBreakdown({
  rows,
  total,
  ariaLabel,
}: {
  rows: BarBreakdownRow[]
  /** The population these rows were computed over — the scale every bar is drawn against. */
  total: number
  ariaLabel: string
}) {
  const scale = Math.max(total, 1, ...rows.map((r) => r.count))

  return (
    <ul aria-label={ariaLabel} className="space-y-1.5 px-4 py-3">
      {rows.map((row) => {
        const fraction = scale > 0 ? Math.min(1, Math.max(0, row.count / scale)) : 0
        return (
          <li key={row.label} className="flex items-center gap-2.5">
            <span className="w-28 shrink-0 truncate text-[11px]/4 text-content-muted" title={row.label}>
              {row.label}
            </span>
            <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className={
                  'block h-full rounded-full ' + (row.danger ? 'bg-(--state-danger-solid)' : 'bg-accent-600')
                }
                style={{ width: `${Math.round(fraction * 100)}%` }}
              />
            </span>
            <span className="w-8 shrink-0 text-right text-[11px]/4 tabular-nums text-content">{row.count}</span>
          </li>
        )
      })}
    </ul>
  )
}
