/**
 * Sparkline — tiny inline SVG polyline or bars (no axes, no labels) for a short
 * numeric series where only SHAPE matters. Strokes/fills use the existing chart
 * tokens (`--chart-success` = accent, `--chart-series` = zinc) — no raw hex, no
 * chart lib. Deterministic from props. `role="img"` + required aria-label.
 */
export function Sparkline({
  points,
  kind = 'line',
  width = 64,
  height = 20,
  tone = 'zinc',
  ariaLabel,
}: {
  points: number[]
  kind?: 'line' | 'bar'
  width?: number
  height?: number
  tone?: 'accent' | 'zinc'
  ariaLabel: string
}) {
  const stroke = tone === 'accent' ? 'var(--chart-success)' : 'var(--chart-series)'

  if (points.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      />
    )
  }

  const max = Math.max(...points, 1)
  const min = Math.min(...points, 0)
  const span = max - min || 1
  const pad = 1

  if (kind === 'bar') {
    const gap = points.length > 1 ? 1 : 0
    const barWidth = (width - gap * (points.length - 1)) / points.length
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        {points.map((p, i) => {
          const h = Math.max(pad, ((p - min) / span) * (height - pad))
          return (
            <rect
              key={i}
              x={i * (barWidth + gap)}
              y={height - h}
              width={barWidth}
              height={h}
              rx={0.5}
              fill={stroke}
            />
          )
        })}
      </svg>
    )
  }

  const step = points.length > 1 ? width / (points.length - 1) : 0
  const d = points
    .map((p, i) => {
      const x = i * step
      const y = height - pad - ((p - min) / span) * (height - pad * 2)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
