/**
 * Direct rendering tests for the three hand-rolled SVG chart primitives —
 * `RingGauge`, `ArcGauge`, `TrendChart` — none of which had a direct test
 * before this file (the audit's own finding: "TrendChart … has NO direct
 * test. Nothing imports it from tests/", and the RingGauge dashed/solid
 * track contract was asserted only on TEXT, never on the track markup
 * itself, so deleting the distinction from the component left every
 * existing assertion green).
 *
 * NODE-TYPE DISCIPLINE, ENFORCED HERE ON PURPOSE: `RingGauge` strokes
 * `<circle>` elements; `ArcGauge` strokes `<path>` elements. A helper that
 * queries the wrong tag passes regardless of what the component actually
 * draws — exactly the blindness the mission calls out. Every selector below
 * is pinned to the real tag, and the "does the track carry `stroke-dasharray`"
 * assertions are the antidote to that specific defect.
 */
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge, UNAVAILABLE } from '@/components/console/charts/ring-gauge'
import { TrendChart, type TrendSeries } from '@/components/console/charts/trend-chart'

/* ================================================================== RingGauge */

describe('RingGauge — the track is the whole distinction, and it must be real markup', () => {
  it('a measured positive value: SOLID track (no dasharray) + a real filled arc drawn as <circle>', () => {
    const { container } = render(<RingGauge value={7} max={14} label="Executable agents" />)

    const circles = container.querySelectorAll('circle')
    // track + glow arc + line arc = 3 circles when a visible arc is drawn
    expect(circles.length).toBe(3)

    const track = circles[0]
    expect(track.getAttribute('stroke-dasharray')).toBeNull()
    expect(track.getAttribute('class')).toContain('stroke-content-subtle')

    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('aria-label')).toBe('Executable agents: 7 out of 14.')
    expect(container.textContent).toContain('7')
    expect(container.textContent).not.toContain(UNAVAILABLE)
  })

  it('value === null: NO arc circles at all, DASHED track, centre prints the literal word', () => {
    const { container } = render(<RingGauge value={null} max={14} label="Executable agents" />)

    const circles = container.querySelectorAll('circle')
    // only the track — no glow, no line arc
    expect(circles.length).toBe(1)
    expect(circles[0].getAttribute('stroke-dasharray')).not.toBeNull()
    expect(circles[0].getAttribute('class')).toContain('stroke-content-faint')

    expect(container.textContent).toContain(UNAVAILABLE)
    const svg = container.querySelector('svg') as SVGElement
    expect(svg.getAttribute('aria-label')).toMatch(/no measurement available/)
  })

  it('a MEASURED zero: solid track, prints the figure "0", still draws no arc (a zero-length arc is a misleading dot)', () => {
    const { container } = render(<RingGauge value={0} max={14} label="Executable agents" />)

    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(1) // track only — no arc for a zero fraction
    expect(circles[0].getAttribute('stroke-dasharray')).toBeNull()
    expect(circles[0].getAttribute('class')).toContain('stroke-content-subtle')

    expect(container.textContent).toContain('0')
    expect(container.textContent).not.toContain(UNAVAILABLE)
  })

  it('a measured zero OUT OF ZERO (empty registry): still the measured vocabulary, never "Indisponible"', () => {
    const { container } = render(<RingGauge value={0} max={0} label="Executable agents" caption="of 0" />)

    expect(container.textContent).toContain('0')
    expect(container.textContent).toContain('of 0')
    expect(container.textContent).not.toContain(UNAVAILABLE)
    const track = container.querySelectorAll('circle')[0]
    expect(track.getAttribute('stroke-dasharray')).toBeNull()
  })

  it('a non-finite value (NaN) is treated as UNMEASURED, never plotted', () => {
    const { container } = render(<RingGauge value={Number.NaN} max={14} label="Executable agents" />)
    expect(container.textContent).toContain(UNAVAILABLE)
    expect(container.querySelectorAll('circle').length).toBe(1)
  })
})

/* =================================================================== ArcGauge */

describe('ArcGauge — same contract, drawn with <path>, never a <circle>', () => {
  it('a measured positive value draws a track <path> (no dasharray) plus glow+line arc <path>s', () => {
    const { container } = render(<ArcGauge value={3} max={14} ariaLabel="Executable agents: 3 of 14." />)

    expect(container.querySelectorAll('circle').length).toBe(0) // ArcGauge never strokes a circle
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(3) // track + glow + line

    const track = paths[0]
    expect(track.getAttribute('stroke-dasharray')).toBeNull()
    expect(track.getAttribute('class')).toContain('stroke-content-subtle')
  })

  it('value === null: exactly ONE path (the dashed track), no arc paths', () => {
    const { container } = render(<ArcGauge value={null} max={14} ariaLabel="Executable agents: unavailable." />)

    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0].getAttribute('stroke-dasharray')).not.toBeNull()
    expect(paths[0].getAttribute('class')).toContain('stroke-content-faint')
  })

  it('a measured zero: solid track, still exactly one path (no misleading dot arc)', () => {
    const { container } = render(<ArcGauge value={0} max={14} ariaLabel="Executable agents: 0 of 14." />)
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(1)
    expect(paths[0].getAttribute('stroke-dasharray')).toBeNull()
    expect(paths[0].getAttribute('class')).toContain('stroke-content-subtle')
  })

  it('max === 0 with a measured value: still the solid/measured track, not the dashed/unmeasured one', () => {
    const { container } = render(<ArcGauge value={0} max={0} ariaLabel="Executable agents: 0 of 0." />)
    const track = container.querySelector('path') as SVGPathElement
    expect(track.getAttribute('stroke-dasharray')).toBeNull()
    expect(track.getAttribute('class')).toContain('stroke-content-subtle')
  })

  it('the arc sweep is proportional to the fraction (regression guard for the round-cap overstatement)', () => {
    // 1 of 14 ≈ 7.1%; with butt caps the drawn arc must clearly be SHORTER
    // than 10 of 14 (≈71.4%) — the bug this replaced painted every non-zero
    // value with the same ~15% floor regardless of the true fraction.
    const low = render(<ArcGauge value={1} max={14} ariaLabel="a" />)
    const high = render(<ArcGauge value={10} max={14} ariaLabel="b" />)

    const lineArcLow = low.container.querySelectorAll('path')[2]
    const lineArcHigh = high.container.querySelectorAll('path')[2]
    const offsetLow = Number(lineArcLow.getAttribute('stroke-dashoffset'))
    const offsetHigh = Number(lineArcHigh.getAttribute('stroke-dashoffset'))
    // dashoffset counts DOWN from full length as the fraction grows, so the
    // higher fraction must have a smaller offset.
    expect(offsetHigh).toBeLessThan(offsetLow)
  })
})

/* ================================================================== TrendChart */

const seriesOf = (points: number[], tone: TrendSeries['tone'] = 'accent'): TrendSeries[] => [
  { key: 'runs', label: 'Runs', tone, points },
]

describe('TrendChart — a populated series draws real marks, in the tone it was given', () => {
  it('non-empty series produces a stroked <path> in the declared tone class, plus the sr-only table', () => {
    const { container } = render(
      <TrendChart series={seriesOf([1, 3, 2, 4, 0, 2])} xLabels={['00', '04', '08', '12', '16', '20']} />
    )

    const paths = [...container.querySelectorAll('path')]
    const accentPaths = paths.filter((path) => (path.getAttribute('class') ?? '').includes('chart-line'))
    expect(accentPaths.length).toBeGreaterThan(0)

    // sr-only mirror exists and carries the real values, not a placeholder
    const table = container.querySelector('table')
    expect(table).toBeTruthy()
    expect(table?.textContent).toContain('4')

    // no empty-state sentence when the window is genuinely populated
    expect(container.querySelector('p[aria-hidden="true"]')).toBeNull()
  })

  it('a DANGER-toned series is stroked with the danger role class, never the accent — and it is a <path>, not a <circle>', () => {
    const { container } = render(
      <TrendChart series={seriesOf([1, 2, 3, 1, 2, 4], 'danger')} xLabels={['a', 'b', 'c', 'd', 'e', 'f']} />
    )
    const paths = [...container.querySelectorAll('path')]
    const dangerPaths = paths.filter((path) => (path.getAttribute('class') ?? '').includes('state-danger-text'))
    expect(dangerPaths.length).toBeGreaterThan(0)
    // never painted in the accent role
    const accentPaths = paths.filter((path) => (path.getAttribute('class') ?? '').includes('chart-line'))
    expect(accentPaths.length).toBe(0)
  })

  it('a measured-EMPTY window (read succeeded, every value is 0): grid + rails drawn, NO curve, real empty sentence', () => {
    const { container } = render(
      <TrendChart
        series={seriesOf([0, 0, 0, 0, 0, 0])}
        xLabels={['00', '04', '08', '12', '16', '20']}
        emptyMessage="No completed or failed run was recorded in this window."
      />
    )

    // structure is still drawn: at least the two rails (baseline + left edge)
    const lines = container.querySelectorAll('line')
    expect(lines.length).toBeGreaterThanOrEqual(2)

    // no curve marks for an empty window
    const paths = container.querySelectorAll('path')
    expect(paths.length).toBe(0)
    const circles = container.querySelectorAll('circle')
    expect(circles.length).toBe(0)

    expect(container.textContent).toContain('No completed or failed run was recorded in this window.')
    // x labels still print — the window WAS observed, only the values are 0
    expect(container.textContent).toContain('20')
  })

  it('NO interval at all (columns === 0): "No interval observed", and the sr-only table is skipped entirely', () => {
    const { container } = render(<TrendChart series={[]} xLabels={[]} />)

    expect(container.textContent).toContain('No interval observed')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelectorAll('path').length).toBe(0)
  })

  it('a RAGGED series (partial coverage): the curve breaks into segments across the gap, and the sr-only cell for that interval says "Indisponible"', () => {
    // 6 labels, but the series only reports 3 points — a partial read, not a
    // fabricated zero for the missing three.
    const { container } = render(
      <TrendChart series={seriesOf([4, 6, 5])} xLabels={['00', '04', '08', '12', '16', '20']} />
    )

    const table = container.querySelector('table') as HTMLTableElement
    const bodyText = table.querySelector('tbody')?.textContent ?? ''
    expect(bodyText).toContain(UNAVAILABLE)

    // the curve for the measured run (indices 0-2) is a SEPARATE path segment
    // from anything after the gap — since there IS nothing after the gap here,
    // this at minimum proves exactly one segment/path was drawn (not one
    // continuous path spanning all 6 columns with invented tail values).
    const accentPaths = [...container.querySelectorAll('path')].filter((path) =>
      (path.getAttribute('class') ?? '').includes('chart-line')
    )
    expect(accentPaths.length).toBe(1)
  })

  it('a NaN sample inside an otherwise complete series breaks the curve into two segments, not one continuous path through the hole', () => {
    const { container } = render(
      <TrendChart series={seriesOf([4, 6, Number.NaN, 5, 7, 6])} xLabels={['a', 'b', 'c', 'd', 'e', 'f']} />
    )
    const accentPaths = [...container.querySelectorAll('path')].filter((path) =>
      (path.getAttribute('class') ?? '').includes('chart-line')
    )
    // two contiguous runs: [0,1] and [3,4,5]
    expect(accentPaths.length).toBe(2)

    const table = container.querySelector('table') as HTMLTableElement
    const cells = [...(table.querySelector('tbody')?.querySelectorAll('td') ?? [])].map((td) => td.textContent)
    expect(cells[2]).toBe(UNAVAILABLE)
  })
})
