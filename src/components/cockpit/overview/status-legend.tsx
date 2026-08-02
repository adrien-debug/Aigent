import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      {slices.map((slice) => (
        <div
          key={slice.status}
          className="inline-flex items-center gap-x-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium bg-white/5 text-(--aig-text-muted) border border-white/5"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ 
              background: RUN_STATUS_COLOR[slice.status],
              boxShadow: `0 0 6px ${RUN_STATUS_COLOR[slice.status]}80`
            }}
          />
          <span className="uppercase tracking-wider">{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text ml-0.5 tabular-nums">{slice.count}</span>
        </div>
      ))}
    </div>
  )
}
