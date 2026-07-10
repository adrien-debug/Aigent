import clsx from 'clsx'

export type SplitTone =
  | 'accent-300'
  | 'accent-400'
  | 'accent-500'
  | 'accent-600'
  | 'accent-700'
  | 'zinc'

const fillTone: Record<SplitTone, string> = {
  'accent-300': 'bg-accent-300 dark:bg-accent-300',
  'accent-400': 'bg-accent-400 dark:bg-accent-400',
  'accent-500': 'bg-accent-500 dark:bg-accent-500',
  'accent-600': 'bg-accent-600 dark:bg-accent-600',
  'accent-700': 'bg-accent-700 dark:bg-accent-700',
  zinc: 'bg-zinc-500 dark:bg-zinc-400',
}

const dotTone: Record<SplitTone, string> = {
  'accent-300': 'bg-accent-300',
  'accent-400': 'bg-accent-400',
  'accent-500': 'bg-accent-500',
  'accent-600': 'bg-accent-600',
  'accent-700': 'bg-accent-700',
  zinc: 'bg-zinc-500 dark:bg-zinc-400',
}

export interface SplitSegment {
  key: string
  label: string
  value: number
  tone: SplitTone
}

/**
 * SplitBar — a single stacked horizontal bar encoding a 2-part ratio or an
 * N-bucket categorical mix in ONE accent ramp (severity/magnitude by INTENSITY,
 * never a second hue). The canonical fix for "a ratio shown as two disconnected
 * big numbers". Legend chips render inline below. Server-safe.
 */
export function SplitBar({
  segments,
  height = 'sm',
  showLegend = true,
  caption,
}: {
  segments: SplitSegment[]
  height?: 'sm' | 'md'
  showLegend?: boolean
  caption?: string
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)

  return (
    <div>
      <div
        className={clsx(
          'flex w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800',
          height === 'md' ? 'h-2.5' : 'h-2'
        )}
      >
        {total > 0
          ? segments.map((s) =>
              s.value > 0 ? (
                <div
                  key={s.key}
                  className={clsx(fillTone[s.tone], 'transition-[flex-basis] duration-300 ease-out motion-reduce:transition-none')}
                  style={{ flexBasis: `${(s.value / total) * 100}%` }}
                />
              ) : null
            )
          : null}
      </div>

      <ul className="sr-only">
        {segments.map((s) => (
          <li key={s.key}>
            {s.label}: {s.value}
          </li>
        ))}
      </ul>

      {showLegend ? (
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1" aria-hidden="true">
          {segments.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1.5">
              <span className={clsx('size-1.5 rounded-full', dotTone[s.tone])} />
              <span className="text-xs text-zinc-500">{s.label}</span>
              <span className="font-mono text-xs text-zinc-600 tabular-nums dark:text-zinc-400">{s.value}</span>
            </span>
          ))}
        </div>
      ) : null}

      {caption ? <p className="mt-1.5 text-xs text-zinc-500">{caption}</p> : null}
    </div>
  )
}
