import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices, lead }: Readonly<{ slices: StatusSlice[]; lead: string }>) {
  return (
    <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-6 lg:gap-x-6 lg:gap-y-0">
      <p className="aig-text-faint col-span-full text-2xs font-medium uppercase tracking-[0.16em] opacity-85 lg:col-span-1">
        {lead}
      </p>
      {slices.map((slice) => (
        <div
          key={slice.status}
          className="flex min-w-0 items-center gap-1.5 whitespace-nowrap text-2xs tabular-nums lg:justify-start"
        >
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status] }}
          />
          <span className="aig-text-muted truncate uppercase tracking-[0.08em]">{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text-faint w-5 text-right">{slice.count}</span>
        </div>
      ))}
    </div>
  )
}
