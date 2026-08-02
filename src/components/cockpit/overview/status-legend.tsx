import { Text } from '@/components/ui/text'
import type { StatusSlice } from '@/lib/cockpit/overview-series'
import { RUN_STATUS_COLOR, RUN_STATUS_LABEL } from '@/lib/cockpit/status'

export function StatusLegend({ slices }: Readonly<{ slices: StatusSlice[] }>) {
  return (
    <Text className="aig-text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {slices.map((slice, index) => (
        <span key={slice.status} className="inline-flex items-center gap-1.5 tabular-nums">
          {index > 0 ? <span className="aig-text-faint hidden sm:inline" aria-hidden>·</span> : null}
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: RUN_STATUS_COLOR[slice.status], opacity: slice.count === 0 ? 0.35 : 1 }}
          />
          <span>{RUN_STATUS_LABEL[slice.status]}</span>
          <span className="aig-text-faint">{slice.count}</span>
        </span>
      ))}
    </Text>
  )
}
