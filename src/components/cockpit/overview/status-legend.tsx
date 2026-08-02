import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <div className="grid w-full grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5 lg:gap-x-6 lg:gap-y-0">
      {slices.map((slice) => (
        <div
          key={slice.status}
          className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-xs tabular-nums lg:justify-start"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status] }}
          />
          <span className="aig-text-muted truncate uppercase tracking-wider">{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text-faint w-5 text-right">{slice.count}</span>
        </div>
      ))}
    </div>
  )
}
