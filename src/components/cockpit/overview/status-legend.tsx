import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 sm:gap-x-5 lg:justify-end">
      {slices.map((slice) => (
        <li
          key={slice.status}
          className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs tabular-nums"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status] }}
          />
          <span className="aig-text-muted">{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text-faint w-[1.25rem] text-right">{slice.count}</span>
        </li>
      ))}
    </ul>
  )
}
