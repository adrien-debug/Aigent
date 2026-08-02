/**
 * Légende de statut du cockpit — pastilles `aig-chip`, pas Badge Catalyst.
 */
import { SeverityChip } from '@/components/surface-primitives'
import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <ul className="flex flex-wrap items-center gap-1.5">
      {slices.map((s) => (
        <li key={s.status}>
          <SeverityChip tone="neutral" className="gap-1.5">
            <span
              aria-hidden
              className="size-1.5 shrink-0 rounded-full"
              style={{ background: RUN_STATUS_COLOR[s.status], opacity: s.count === 0 ? 0.3 : 1 }}
            />
            {RUN_STATUS_LABEL[s.status]}
            <span className="tabular-nums">{s.count}</span>
          </SeverityChip>
        </li>
      ))}
    </ul>
  )
}
