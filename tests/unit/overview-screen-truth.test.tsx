/**
 * Component tests — the /admin overview screen must never dress an absent
 * measurement as a measured one.
 *
 * THE RULE UNDER TEST (one sentence, and every assertion below is a instance of
 * it): a `null` metric renders the exact word `Indisponible`; a MEASURED `0`
 * renders `0`. Nothing turns a null into 0, "0 run", "0 %", an empty gauge arc
 * or a flat-zero curve.
 *
 * These render the REAL screen (`OverviewScreen`) against hand-built
 * `DashboardOverview` fixtures — no network, no backend, no route. The screen is
 * a synchronous server component, so RTL can render it directly.
 */
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ArcGauge } from '@/components/console/charts/arc-gauge'
import { RingGauge } from '@/components/console/charts/ring-gauge'
import { OverviewScreen } from '@/components/console/overview-screen'
import { KpiCard, PanelRow, Unavailable } from '@/components/console/screen-primitives'
// TYPE-ONLY. `dashboard-overview.ts` is `server-only`; importing a VALUE from it
// in this (browser-conditions) project throws at import time.
import type { DashboardOverview, ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import type { AgentRun } from '@/lib/agent-mission-control/types'

/* ---------------------------------------------------------------- fixtures */

const UNAVAILABLE = 'Indisponible'

/** Copy of `RUNS_READ_FAILED_WARNING`. The unit test
 *  (`tests/unit/dashboard-overview.test.ts`, A4) pins the exported constant to
 *  this exact sentence, so the two cannot drift apart unnoticed. */
const RUNS_READ_FAILED_WARNING = 'Run history unavailable'

function kpis(partial: Partial<DashboardOverview['kpis']> = {}): DashboardOverview['kpis'] {
  return {
    productionAgents: 1,
    readyForManualTest: 0,
    sandboxPassRate: null,
    avgRepoFit: null,
    blockedDeliveries: 0,
    executableNow: 1,
    executableTotal: 2,
    runs24h: 0,
    success24h: null,
    cost24h: null,
    needsAction: 0,
    ...partial,
  }
}

function projectItem(partial: Partial<ProjectOverviewItem> = {}): ProjectOverviewItem {
  return {
    id: 'proj-trade',
    name: 'TradeAgent',
    imageUrl: null,
    logoUrl: null,
    repoFullName: 'adrien-debug/TradeAgent',
    platform: 'web',
    copilotCount: 2,
    activeCount: 1,
    runsLast24h: 0,
    costLast24hUsd: 0,
    passRate: null,
    ...partial,
  }
}

function overviewFixture(partial: Partial<DashboardOverview> = {}): DashboardOverview {
  return {
    kpis: kpis(),
    projects: [],
    actionItems: [],
    dataWarnings: [],
    windowRuns: [],
    ...partial,
  }
}

/** A window whose runs read FAILED: every run-derived figure is null and the
 *  failure is named in `dataWarnings`. */
function unreadWindow(): DashboardOverview {
  return overviewFixture({
    kpis: kpis({ runs24h: null, success24h: null, cost24h: null }),
    windowRuns: null,
    dataWarnings: [RUNS_READ_FAILED_WARNING],
  })
}

/** A window that WAS read and held nothing: the same figures, measured at 0. */
function measuredEmptyWindow(): DashboardOverview {
  return overviewFixture({
    kpis: kpis({ runs24h: 0 }),
    windowRuns: [] as AgentRun[],
    dataWarnings: [],
  })
}

/** The card whose uppercase label is `label`, as a query root. */
function kpiCard(label: string): HTMLElement {
  const labelNode = screen.getByText(label)
  const card = labelNode.closest('div.rounded-xl')
  if (card === null) throw new Error(`No KPI card found for label "${label}"`)
  return card as HTMLElement
}

/**
 * Every stroked arc a gauge draws on top of its track — the accent-coloured
 * fill. Absent means "no arc was drawn", which is the whole point for a null.
 *
 * BOTH SHAPES, on purpose: `ArcGauge` strokes `<path>` semicircles and
 * `RingGauge` strokes `<circle>` donuts. A `path`-only query returned 0 for a
 * ring drawing two real arcs, which made every ring assertion below unfailable —
 * a green check that proved nothing. Probed in both directions: with `circle`
 * included, `<RingGauge value={62} …>` reports 2 and `value={null}` reports 0.
 */
function drawnArcs(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('path, circle')].filter((shape) =>
    /--chart-line|--accent-glow/.test(shape.getAttribute('class') ?? '')
  )
}

/* ---------------------------------------------------------- C1 · null → word */

describe('C1 — a null runs figure renders the exact word "Indisponible"', () => {
  it('the "Runs · 24h" KPI card says Indisponible when the window was never read', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    expect(within(kpiCard('Runs · 24h')).getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('the KPI card carries no fabricated figure beside the word', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    const card = kpiCard('Runs · 24h')
    expect(card.textContent).toContain(UNAVAILABLE)
    // Not "0", not "0 run" — no digit at all in the figure slot.
    expect(within(card).queryByText('0')).toBeNull()
  })

  it('the failure is stated out loud, in the danger role, not swallowed', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    expect(screen.getAllByText(RUNS_READ_FAILED_WARNING).length).toBeGreaterThan(0)
  })

  it('a project row whose team proved nothing says Indisponible for `runs`', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({ projects: [projectItem({ runsLast24h: null })] })}
      />
    )

    const runsCaption = screen.getByText('runs')
    const cell = runsCaption.parentElement
    expect(cell).not.toBeNull()
    expect(cell?.textContent).toContain(UNAVAILABLE)
    expect(cell?.textContent).not.toContain('0')
  })
})

/* --------------------------------------------------- C2 · measured 0 → "0" */

describe('C2 — a MEASURED zero renders 0, never Indisponible', () => {
  it('a window that was read and held nothing shows 0 in the Runs card', () => {
    render(<OverviewScreen overview={measuredEmptyWindow()} />)

    const card = kpiCard('Runs · 24h')
    expect(within(card).getByText('0')).toBeTruthy()
    expect(within(card).queryByText(UNAVAILABLE)).toBeNull()
  })

  it('a project row whose team proved a zero shows 0', () => {
    render(
      <OverviewScreen overview={overviewFixture({ projects: [projectItem({ runsLast24h: 0 })] })} />
    )

    const cell = screen.getByText('runs').parentElement
    expect(cell?.textContent).toContain('0')
    expect(cell?.textContent).not.toContain(UNAVAILABLE)
  })

  it('a project row with a measured positive count shows it unchanged', () => {
    render(
      <OverviewScreen overview={overviewFixture({ projects: [projectItem({ runsLast24h: 12 })] })} />
    )

    const cell = screen.getByText('runs').parentElement
    expect(cell?.textContent).toContain('12')
    expect(cell?.textContent).not.toContain(UNAVAILABLE)
  })

  it('the unread and the measured-empty screens do NOT render the same figure', () => {
    const { unmount } = render(<OverviewScreen overview={measuredEmptyWindow()} />)
    const measured = kpiCard('Runs · 24h').textContent
    unmount()

    render(<OverviewScreen overview={unreadWindow()} />)
    const unread = kpiCard('Runs · 24h').textContent

    expect(measured).not.toBe(unread)
    expect(measured).toContain('0')
    expect(unread).toContain(UNAVAILABLE)
  })
})

/* ------------------------------------------- C3 · no misleading gauge/curve */

describe('C3 — a null measurement draws no gauge arc and no zero curve', () => {
  it('no accent arc is stroked anywhere while the window is unread', () => {
    const { container } = render(<OverviewScreen overview={unreadWindow()} />)

    // success24h is null: the KPI-card arc AND the big panel ring must both draw
    // the track only. There are TWO gauges under this label — checking only the
    // first left the ring untested, so every one of them is asserted.
    const gauges = [...container.querySelectorAll('svg[aria-label*="Success rate"]')]
    expect(gauges).toHaveLength(2)
    for (const gauge of gauges) expect(drawnArcs(gauge as HTMLElement)).toHaveLength(0)
  })

  it('the trend chart says nothing rather than drawing a flat-zero curve', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    const panel = screen.getByText('Run activity · 24h').closest('section')
    expect(panel).not.toBeNull()
    // No axis, no grid, no curve: nothing at all is plotted from a window that
    // was never read — an empty plate would be indistinguishable from a quiet one.
    expect(panel?.querySelectorAll('svg')).toHaveLength(0)
    expect(panel?.querySelectorAll('polyline')).toHaveLength(0)
    expect(drawnArcs(panel as HTMLElement)).toHaveLength(0)
  })

  it('a MEASURED empty window still draws its own honest empty plate', () => {
    render(<OverviewScreen overview={measuredEmptyWindow()} />)

    const panel = screen.getByText('Run activity · 24h').closest('section')
    // The read succeeded, so the chart is reached and states its emptiness —
    // this is the case the unread window must NOT be allowed to imitate.
    expect(panel?.textContent).toContain('No completed or failed run was recorded in this window.')
  })

  it('the projects-active gauge does not present unmeasured projects as inactive', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          projects: [
            projectItem({ id: 'p1', name: 'A', runsLast24h: null }),
            projectItem({ id: 'p2', name: 'B', runsLast24h: null }),
          ],
        })}
      />
    )

    const card = kpiCard('Projects · active')
    // Nothing was measured, so the numerator is not a fact — "0 / 2" would claim
    // both projects sat idle, which no read established.
    expect(card.textContent).not.toContain('0 / 2')
    expect(within(card).getByText(UNAVAILABLE)).toBeTruthy()
    // …and the gauge beside it draws no arc, over a DASHED (unmeasured) track.
    expect(drawnArcs(card)).toHaveLength(0)
    expect(card.querySelector('path')?.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  it('the status breakdown says Indisponible five times rather than five zeros', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    const panel = screen.getByText('Success rate · 24h').closest('section')
    expect(panel).not.toBeNull()
    // One per run status. Five `0`s here would describe a fleet that never ran.
    expect(within(panel as HTMLElement).getAllByText(UNAVAILABLE).length).toBeGreaterThanOrEqual(5)
  })

  it('the status breakdown shows measured zeros when the window WAS read', () => {
    render(<OverviewScreen overview={measuredEmptyWindow()} />)

    const panel = screen.getByText('Success rate · 24h').closest('section')
    expect(within(panel as HTMLElement).getAllByText('0')).toHaveLength(5)
  })

  it('the Agents panel splits what the failed read cost from what still holds', () => {
    render(<OverviewScreen overview={unreadWindow()} />)

    const panel = screen.getByText('Agents').closest('section') as HTMLElement
    // `Ran · 24h` came from windowRuns → unavailable.
    const ran = within(panel).getByText('Ran · 24h').parentElement
    expect(ran?.textContent).toContain(UNAVAILABLE)
    // `Production` came from another read → still a measurement.
    const production = within(panel).getByText('Production').parentElement
    expect(production?.textContent).toContain('1')
    expect(production?.textContent).not.toContain(UNAVAILABLE)
  })
})

/* ------------------------------------- the primitives that carry the rule */

describe('the render primitives behind the rule', () => {
  it('Unavailable is the single spelling of the absent measurement', () => {
    render(<Unavailable />)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('KpiCard shows a measured 0 as 0 and an absence as the word', () => {
    const { unmount } = render(<KpiCard label="Runs" value={0} />)
    expect(screen.getByText('0')).toBeTruthy()
    expect(screen.queryByText(UNAVAILABLE)).toBeNull()
    unmount()

    render(<KpiCard label="Runs" value={<Unavailable />} />)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('PanelRow shows a measured 0 as 0 and an absence as the word', () => {
    const { unmount } = render(<PanelRow title="TradeAgent" values={[{ label: 'runs', value: 0 }]} />)
    expect(screen.getByText('0')).toBeTruthy()
    unmount()

    render(<PanelRow title="TradeAgent" values={[{ label: 'runs', value: <Unavailable /> }]} />)
    expect(screen.getByText(UNAVAILABLE)).toBeTruthy()
  })

  it('ArcGauge draws NO arc for null, and keeps a measured 0 distinguishable', () => {
    const nullGauge = render(<ArcGauge value={null} ariaLabel="unmeasured" />)
    expect(drawnArcs(nullGauge.container)).toHaveLength(0)
    const nullTrack = nullGauge.container.querySelector('path')
    // Dashed track = nothing was ever measured.
    expect(nullTrack?.getAttribute('stroke-dasharray')).toBeTruthy()
    nullGauge.unmount()

    const zeroGauge = render(<ArcGauge value={0} ariaLabel="measured zero" />)
    expect(drawnArcs(zeroGauge.container)).toHaveLength(0)
    const zeroTrack = zeroGauge.container.querySelector('path')
    // Solid track = a measurement exists and it is zero.
    expect(zeroTrack?.getAttribute('stroke-dasharray')).toBeFalsy()
  })

  it('RingGauge writes Indisponible in its centre for a null and 0 for a measured zero', () => {
    const nullRing = render(<RingGauge value={null} label="Success rate" />)
    expect(within(nullRing.container).getByText(UNAVAILABLE)).toBeTruthy()
    expect(drawnArcs(nullRing.container)).toHaveLength(0)
    nullRing.unmount()

    const zeroRing = render(<RingGauge value={0} label="Success rate" />)
    expect(within(zeroRing.container).getByText('0')).toBeTruthy()
    expect(within(zeroRing.container).queryByText(UNAVAILABLE)).toBeNull()
  })
})
