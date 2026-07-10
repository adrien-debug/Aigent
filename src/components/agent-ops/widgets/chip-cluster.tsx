import { Badge } from '@/components/catalyst/badge'

type ChipTone = 'zinc' | 'accentStrong' | 'accentSolid'

export interface ChipItem {
  key: string
  text: string
  icon?: React.ReactNode
}

/**
 * ChipCluster — dense wrapped row of mono chips for any string[] that would
 * otherwise render one-item-per-line (the #1 source of wasted vertical air).
 * Collapses tall <ul> lists into a flowing cluster with a leading count and a
 * '+N' overflow chip. Reuses Catalyst Badge — never recreates it. Semantics
 * ride on the LABEL + Badge intensity, never on hue. Server-safe.
 */
export function ChipCluster({
  label,
  items,
  tone = 'zinc',
  max,
  count = true,
  emptyText,
}: {
  label?: string
  items: ChipItem[]
  tone?: ChipTone
  /** Overflow beyond `max` collapses into a '+N' chip carrying the full list in its title. */
  max?: number
  count?: boolean
  emptyText?: string
}) {
  const visible = typeof max === 'number' ? items.slice(0, max) : items
  const overflow = items.slice(visible.length)

  return (
    <div>
      {label ? (
        <p className="text-xs font-medium tracking-wide text-zinc-500 uppercase">
          {label}
          {count ? (
            <span className="ml-1 font-mono normal-case tabular-nums">· {items.length}</span>
          ) : null}
        </p>
      ) : null}

      {items.length > 0 ? (
        <div className={label ? 'mt-3 flex flex-wrap gap-2' : 'flex flex-wrap gap-2'}>
          {visible.map((item) => (
            <Badge key={item.key} color={tone} className="font-mono">
              {item.icon ? <span aria-hidden="true">{item.icon}</span> : null}
              {item.text}
            </Badge>
          ))}
          {overflow.length > 0 ? (
            <Badge color="zinc" className="font-mono" title={overflow.map((o) => o.text).join(', ')}>
              +{overflow.length}
            </Badge>
          ) : null}
        </div>
      ) : (
        <p className={label ? 'mt-3 text-sm text-zinc-500' : 'text-sm text-zinc-500'}>
          {emptyText ?? 'None.'}
        </p>
      )}
    </div>
  )
}
