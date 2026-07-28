/**
 * One KPI figure. Shared by the dashboard and any surface that needs the same
 * cell — extracted because it has three real call sites in the rebuilt
 * dashboard, not as a speculative wrapper (P004).
 *
 * `value === null` is the whole point of this component: the dashboard's
 * numbers are nullable BY CONTRACT (`dashboard-overview.ts` documents
 * "UNAVAILABLE, never 0" and "NOT_APPLICABLE, never 0"), so an absent
 * measurement renders as a stated absence and never as a zero.
 */
export function KpiTile({
  label,
  value,
  note,
  tone,
}: {
  label: string
  /** Pre-formatted, or `null` when nothing measured it. */
  value: string | null
  note?: string
  tone?: 'accent' | 'danger'
}) {
  const missing = value === null

  return (
    <div className="rounded-2xl bg-surface-sunken p-4">
      <p className="text-xs font-medium text-zinc-400">{label}</p>
      <p
        className={[
          'mt-2 font-semibold tabular-nums',
          missing ? 'text-base text-zinc-400' : 'text-2xl',
          !missing && tone === 'accent' ? 'text-accent-300' : '',
          !missing && tone === 'danger' ? 'text-[var(--state-danger-text)]' : '',
          !missing && !tone ? 'text-white' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {missing ? 'Not measured' : value}
      </p>
      {note ? <p className="mt-1 text-[11px]/4 text-zinc-400">{note}</p> : null}
    </div>
  )
}
