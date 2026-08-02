import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <ul className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">
      {slices.map((slice) => (
        <li key={slice.status} className="flex min-w-0 items-center gap-1.5 text-xs tabular-nums">
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status] }}
          />
          <span className="aig-text-muted truncate">{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text-faint shrink-0">{slice.count}</span>
        </li>
      ))}
    </ul>
  )
}
