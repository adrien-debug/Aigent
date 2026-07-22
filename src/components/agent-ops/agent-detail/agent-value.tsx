import { NotMeasuredDash } from '@/components/agent-ops/empty-state'

/**
 * Value renderers for the agent detail (AIGENT-AGENT-PAGES-021).
 *
 * The whole point is that `null` and `0` are different claims and must never
 * render alike. `0` means a window was read and held nothing; `null` means
 * nothing ever measured it. The legacy pages coerced the second into the first,
 * so an agent that had never run showed "0.0% success" as if it had failed.
 */

/** A measured count. `null` ⇒ never measured ⇒ dash, never 0. */
export function CountValue({ value }: { value: number | null }) {
  if (value === null) return <NotMeasuredDash />
  return <>{value.toLocaleString('en-US')}</>
}

/** Ratio 0..1 as a percentage. `null` ⇒ dash. */
export function RateValue({ value }: { value: number | null }) {
  if (value === null) return <NotMeasuredDash />
  return <>{(value * 100).toFixed(0)}%</>
}

/** USD. `null` ⇒ dash — an unmeasured cost is not a free run. */
export function CostValue({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <NotMeasuredDash />
  if (value === 0) return <>$0.00</>
  return <>${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}</>
}

/** Duration in ms → human. `null` ⇒ dash. */
export function DurationValue({ value }: { value: number | null }) {
  if (value === null || !Number.isFinite(value)) return <NotMeasuredDash />
  if (value < 1000) return <>{Math.round(value)} ms</>
  if (value < 60_000) return <>{(value / 1000).toFixed(1)} s</>
  return <>{Math.round(value / 60_000)} min</>
}

/**
 * Relative timestamp. `null` ⇒ explicit "Never", which IS the measurement.
 *
 * Rendering is pure: `Date.now()` in a component body is impure (the lint rule
 * catches it) and, worse, would produce a different string on the server than
 * on hydration. The caller passes `now` when it wants a relative label; the
 * default is an absolute UTC date, which is correct at any moment.
 */
export function TimeAgoValue({
  value,
  now,
  never = 'Never',
}: {
  value: string | null
  now?: number
  never?: string
}) {
  if (value === null) return <>{never}</>
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return <NotMeasuredDash />
  if (now === undefined) {
    return (
      <time dateTime={value} className="tabular-nums">
        {new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC
      </time>
    )
  }
  const diff = now - t
  if (diff < 60_000) return <>Just now</>
  if (diff < 3_600_000) return <>{Math.floor(diff / 60_000)} min ago</>
  if (diff < 86_400_000) return <>{Math.floor(diff / 3_600_000)} h ago</>
  return <>{Math.floor(diff / 86_400_000)} d ago</>
}

/** Absolute UTC timestamp, for detail rows where "3 h ago" is not precise enough. */
export function TimestampValue({ value }: { value: string | null }) {
  if (value === null) return <NotMeasuredDash />
  const t = Date.parse(value)
  if (!Number.isFinite(t)) return <NotMeasuredDash />
  return (
    <time dateTime={value} className="font-mono tabular-nums">
      {new Date(t).toISOString().replace('T', ' ').slice(0, 19)} UTC
    </time>
  )
}

/** A string that may be absent. Absent ⇒ dash, never an invented placeholder. */
export function TextValue({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined || value.trim() === '') return <NotMeasuredDash />
  return <>{value}</>
}
