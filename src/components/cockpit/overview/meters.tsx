import clsx from 'clsx'

export function Led({
  color,
  live = false,
  className,
}: Readonly<{ color: string; live?: boolean; className?: string }>) {
  return (
    <span
      aria-hidden
      className={clsx('size-1.5 shrink-0 rounded-full', live && 'pulse-live', className)}
      style={{ background: color }}
    />
  )
}

export function BarMeter({
  ratio,
  color,
  className,
}: Readonly<{ ratio: number; color: string; className?: string }>) {
  const pct = Math.min(Math.max(ratio, 0), 1) * 100
  return (
    <div
      aria-hidden
      className={clsx(
        'h-1.5 w-full overflow-hidden rounded-full bg-[color-mix(in_oklab,var(--aig-line)_60%,transparent)]',
        className,
      )}
    >
      <div
        className="h-full rounded-full transition-[width]"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  )
}

export function SegmentMeter({
  filled,
  total,
  color,
  className,
}: Readonly<{ filled: number; total: number; color: string; className?: string }>) {
  const safeTotal = Math.max(total, 0)
  const safeFilled = Math.min(Math.max(filled, 0), safeTotal)

  if (safeTotal === 0) {
    return (
      <div
        className={clsx(
          'h-1.5 w-full rounded-full bg-[color-mix(in_oklab,var(--aig-line)_60%,transparent)]',
          className,
        )}
      />
    )
  }

  if (safeTotal > 24) {
    return <BarMeter ratio={safeFilled / safeTotal} color={color} className={className} />
  }

  return (
    <div aria-hidden className={clsx('flex items-end gap-[2px]', className)}>
      {Array.from({ length: safeTotal }, (_, i) => (
        <span
          key={i}
          className={clsx('h-3.5 w-[3px] rounded-[1px]', i >= safeFilled && 'bg-[var(--aig-line)]')}
          style={i < safeFilled ? { background: color } : undefined}
        />
      ))}
    </div>
  )
}

export function ArcGauge({
  ratio,
  color,
  size = 44,
  label,
}: Readonly<{ ratio: number; color: string; size?: number; label?: string }>) {
  const stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const clamped = Math.min(Math.max(ratio, 0), 1)

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className="shrink-0"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--aig-line)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${c * clamped} ${c}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </svg>
  )
}
