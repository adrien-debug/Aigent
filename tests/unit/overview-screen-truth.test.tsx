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
import { ProjectsScreen } from '@/components/console/projects-screen'
import { KpiCard, PanelRow, Unavailable } from '@/components/console/screen-primitives'
// TYPE-ONLY. `dashboard-overview.ts` is `server-only`; importing a VALUE from it
// in this (browser-conditions) project throws at import time.
import type {
  Cost24hCoverage,
  DashboardOverview,
  ProjectOverviewItem,
  RecentDelivery,
} from '@/lib/agent-mission-control/dashboard-overview'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import type { AgentRun, Copilot } from '@/lib/agent-mission-control/types'
// The fixture the DATA-LAYER suite pins (dashboard-overview.test.ts › C13) and
// this suite renders. One literal, two vitest projects — see its header for why
// duplicating it into each file would defeat the point of section D6.
import {
  CROSS_SCREEN_ITEMS,
  CROSS_SCREEN_PROJECTS,
  CROSS_SCREEN_TEAM,
} from '../fixtures/cross-screen-cost'

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
    telemetryHealth: {
      status: 'not_configured',
      summary: 'Runtime telemetry ingestion is not configured.',
      daysSinceLastEvent: null,
      agentsWithTelemetryDeclared: null,
    },
    telemetryReportingAgents: null,
    telemetryRunsMeasured: null,
    recentDeliveries: [],
    pendingArchitectApprovals: [],
    recentTelemetryEvents: [],
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
    // The read succeeded, so the empty case is reached and states its own
    // emptiness — this is what the UNREAD window must never be allowed to
    // imitate, and the assertion above proves the unread one stays silent.
    expect(panel?.textContent).toContain('No completed or failed run in this window')
    // ...and it says WHY it is empty, so "nothing ran" cannot read as "the
    // chart broke".
    expect(panel?.textContent).toContain('The window was read and held nothing')

    // It is the COMPACT placeholder, not a full-size grid drawn around one
    // sentence: a 232px black plate is the empty-graph antipattern this
    // console removes, and it is what shipped here before.
    const placeholder = panel?.querySelector('.h-24')
    expect(placeholder).not.toBeNull()
    expect(panel?.querySelectorAll('polyline')).toHaveLength(0)
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

/* ======================================================================== */
/* D · COST — the same rule as runs, held on BOTH screens                   */
/*                                                                          */
/* Two different figures wear the word "cost" in this console and they come */
/* from two different reads, so they are tested apart:                      */
/*   · `/admin` › "Cost · 24h" KPI ← `kpis.cost24h`, derived from the        */
/*     WINDOW's runs. `Cost24hCoverage | null` — a window can be measured    */
/*     only IN PART, so the figure travels with its denominator.            */
/*   · `/admin/projects` › the "Cost · 24h" column ← the TEAM's health,      */
/*     rolled up per project.                                              */
/* One law over both: `$0.00` is printed only when something was measured   */
/* at zero. An absence is the word `Indisponible` — never "$0.00", never    */
/* "—", never an empty gauge, never a zero bar.                             */
/* ======================================================================== */

/* ------------------------------------------------------------- D fixtures */

function coverage(partial: Partial<Cost24hCoverage> = {}): Cost24hCoverage {
  return { usd: 0, measuredRuns: 1, totalRuns: 1, ...partial }
}

/**
 * A COMPLETE run in the window. Written out rather than cast from a two-field
 * literal: the screen buckets `startedAt` and counts `status` for the panels
 * beside the Cost card, and a partial blob renders `NaN` in them — a fixture
 * that quietly breaks a neighbouring assertion is worse than no fixture.
 */
function agentRun(partial: Partial<AgentRun> & Pick<AgentRun, 'id'>): AgentRun {
  return {
    copilotId: 'c-btc',
    versionId: 'v1',
    projectId: 'p-proven',
    userLabel: 'operator',
    startedAt: '2026-07-29T09:00:00Z',
    finishedAt: '2026-07-29T09:00:10Z',
    status: 'completed',
    stepIds: [],
    inputSummary: '',
    outputSummary: '',
    toolCallCount: 0,
    unsafeAttemptCount: 0,
    latencyMs: 1200,
    costUsd: null,
    traceUrl: null,
    ...partial,
  }
}

/**
 * The em dash. NOT what `formatUsd` returns any more — it returns the same word
 * `UNAVAILABLE` above, so the two spellings of one absence are now one.
 *
 * Kept, and still forbidden, because the assertion is broader than its original
 * cause: it is punctuation, this console spells an absent measurement with a
 * WORD, and a cost slot showing "—" would mean SOME new source of the old
 * vocabulary crept back in — a hand-written fallback, a copied cell, a fresh
 * `?? '—'`. The guard outlives the bug that motivated it.
 */
const EM_DASH_ABSENCE = '—'

/** The KPI card carrying `label` INSIDE a given container — `/admin/projects`
 *  spells "Cost · 24h" twice (the card and the table header), so a page-wide
 *  `getByText` finds two nodes and the query has to be scoped. */
function kpiCardIn(container: HTMLElement, label: string): HTMLElement {
  const card = within(container)
    .getAllByText(label)
    .map((node) => node.closest('div.rounded-xl'))
    .find((node): node is HTMLElement => node !== null)
  if (card === undefined) throw new Error(`No KPI card found for label "${label}"`)
  return card
}

/**
 * The `/admin/projects` registry, keyed by project name.
 *
 * Keyed on the row's own title element rather than on the first cell's text: the
 * first cell also carries the platform/description subtitle, so a fixture that
 * changes a slug would silently change the key and every lookup would return
 * `undefined` — an assertion failing for the wrong reason.
 * Cell order: project · repository · serving/team · runs · cost · builder.
 */
function registryRows(container: HTMLElement): Map<string, string[]> {
  const rows = new Map<string, string[]>()
  for (const row of container.querySelectorAll('tbody tr')) {
    const name = row.querySelector('td p')?.textContent ?? ''
    rows.set(
      name,
      [...row.querySelectorAll('td')].map((cell) => cell.textContent ?? '')
    )
  }
  return rows
}

/**
 * Any mark a CHART could stroke or fill. Broader than `drawnArcs` on purpose —
 * it is used to claim that NOTHING is drawn beside an absent cost, so it must
 * not be able to miss a bar, a slice or a curve either.
 *
 * DECORATIVE ICONS ARE NOT MARKS, and excluding them was measured, not assumed:
 * the `All projects` link at the foot of the Projects panel carries a heroicon,
 * which made the first version of this helper report 2 "marks" in a panel that
 * plots nothing. Heroicons render `data-slot="icon" aria-hidden="true"`; both
 * gauges render `role="img"` with a real `aria-label`. The distinction is the
 * component contract, not a guess. A positive control in D4 proves the helper
 * still sees a genuine mark after this filtering.
 */
function drawnMarks(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('svg, path, circle, rect, polyline, polygon, line')].filter(
    (node) => node.closest('[data-slot="icon"]') === null
  )
}

/* ---------------------------------------------- D1 · a null cost → the word */

describe('D1 — an absent cost renders the exact word "Indisponible" on /admin', () => {
  it('the "Cost · 24h" KPI card says Indisponible, and shows no currency at all', () => {
    render(<OverviewScreen overview={overviewFixture({ kpis: kpis({ cost24h: null }) })} />)

    const card = kpiCard('Cost · 24h')
    expect(within(card).getByText(UNAVAILABLE)).toBeTruthy()
    // The three shapes a coalesced absence took, all forbidden in one place.
    expect(card.textContent).not.toContain('$')
    expect(card.textContent).not.toContain('0.00')
    expect(card.textContent).not.toContain(EM_DASH_ABSENCE)
  })

  it('ALL THREE reasons for a null cost render the word, each naming its own cause', () => {
    // Same figure, three different absences. The word must be identical (an
    // operator learns ONE spelling) and the sub-label must differ (or
    // "Indisponible" under a line still claiming "Summed over the window's runs"
    // reads as a formatting glitch rather than a missing measurement).
    const cases = [
      { name: 'the run read FAILED', overview: unreadWindow() },
      {
        name: 'the window was read and held NO run',
        overview: overviewFixture({ kpis: kpis({ cost24h: null }), windowRuns: [] as AgentRun[] }),
      },
      {
        name: 'runs were read but NOT ONE carried a measurable cost',
        overview: overviewFixture({
          kpis: kpis({ runs24h: 3, cost24h: null }),
          // Three real runs, none of them priced — `costUsd: null` is the
          // default, and it means "the runner could not measure it".
          windowRuns: [agentRun({ id: 'r1' }), agentRun({ id: 'r2' }), agentRun({ id: 'r3' })],
        }),
      },
    ]

    const details = new Set<string>()
    for (const { name, overview } of cases) {
      const { unmount } = render(<OverviewScreen overview={overview} />)
      const card = kpiCard('Cost · 24h')

      expect(within(card).getByText(UNAVAILABLE), name).toBeTruthy()
      expect(card.textContent, name).not.toContain('$')

      const detail = card.querySelector('p:last-of-type')?.textContent ?? ''
      expect(detail, name).not.toBe('')
      details.add(detail)
      unmount()
    }

    // Three causes, three sentences — none of them borrowed from another.
    expect(details.size).toBe(3)
  })

  it('a project whose team proved no cost carries no fabricated $0.00 on /admin', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({ projects: [projectItem({ runsLast24h: 3, costLast24hUsd: null })] })}
      />
    )

    const panel = screen.getByText('Projects').closest('section') as HTMLElement
    // Whatever this panel chooses to display, it may never put a currency figure
    // against a project whose cost nobody measured. Holds today (the row shows
    // `active` and `runs` only) and holds after a cost cell is added, because the
    // only correct rendering there is the word, not a zero.
    expect(panel.textContent).not.toContain('$')
    expect(panel.textContent).not.toContain(EM_DASH_ABSENCE)
  })
})

/* --------------------------------------- D2 · a measured zero → a real zero */

describe('D2 — a MEASURED zero cost renders a real formatted zero, never the word', () => {
  it('the "Cost · 24h" KPI card shows $0.00 when the window was priced at zero', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 0, measuredRuns: 4, totalRuns: 4 }) }),
        })}
      />
    )

    const card = kpiCard('Cost · 24h')
    expect(within(card).getByText('$0.00')).toBeTruthy()
    // The inverse lie: relabelling every zero "not measured" is the same defect
    // pointing the other way.
    expect(within(card).queryByText(UNAVAILABLE)).toBeNull()
    expect(card.textContent).not.toContain(EM_DASH_ABSENCE)
  })

  it('a measured zero and an absence do NOT render the same card', () => {
    const { unmount } = render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 0, measuredRuns: 4, totalRuns: 4 }) }),
        })}
      />
    )
    const measured = kpiCard('Cost · 24h').textContent
    unmount()

    render(<OverviewScreen overview={overviewFixture({ kpis: kpis({ cost24h: null }) })} />)
    const absent = kpiCard('Cost · 24h').textContent

    expect(measured).not.toBe(absent)
    expect(measured).toContain('$0.00')
    expect(absent).toContain(UNAVAILABLE)
  })
})

/* ------------------------------------------ D3 · a positive value, formatted */

describe('D3 — a measured cost is formatted as currency, with its coverage', () => {
  it('the figure is the canonical "$2.50", not a raw number and not a rounded one', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 2.5, measuredRuns: 4, totalRuns: 4 }) }),
        })}
      />
    )

    // The FIGURE slot, read directly rather than searched for: `toContain` over
    // the whole card would also be satisfied by "$2.50" appearing in the
    // sub-label, and the assertion is about what sits in the big slot.
    // Selector follows `Metric`'s figure slot, which is now `text-[30px]/9`
    // (the figure was enlarged so it clearly outranks its own label). The
    // assertion below is unchanged — this is still "what sits in the big slot".
    const figure = kpiCard('Cost · 24h').querySelector('p.text-\\[30px\\]\\/9')
    expect(figure?.textContent).toBe('$2.50')
    expect(within(kpiCard('Cost · 24h')).queryByText(UNAVAILABLE)).toBeNull()
  })

  it('sub-cent and large amounts keep two decimals rather than collapsing', () => {
    const { unmount } = render(
      <OverviewScreen
        overview={overviewFixture({ kpis: kpis({ runs24h: 1, cost24h: coverage({ usd: 0.004 }) }) })}
      />
    )
    // 0.004 rounds to "$0.00" — a HONEST rounding of a measured amount, and it
    // must still not be confused with an absence: the card keeps its currency.
    expect(kpiCard('Cost · 24h').textContent).toContain('$0.00')
    expect(within(kpiCard('Cost · 24h')).queryByText(UNAVAILABLE)).toBeNull()
    unmount()

    render(<OverviewScreen overview={overviewFixture({ kpis: kpis({ runs24h: 1, cost24h: coverage({ usd: 1234.5 }) }) })} />)
    expect(kpiCard('Cost · 24h').textContent).toContain('$1234.50')
  })

  it('PARTIAL coverage is disclosed — dollars are never presented as the whole window', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 2.5, measuredRuns: 3, totalRuns: 4 }) }),
        })}
      />
    )

    const card = kpiCard('Cost · 24h')
    // The figure is a LOWER BOUND: one of the four runs had no measurable cost.
    // Printing "$2.50" alone would be the same overstatement the `?? 0` made,
    // only better dressed — so both halves of the fraction must be on screen.
    expect(card.textContent).toContain('$2.50')
    expect(card.textContent).toMatch(/\b3\b[^0-9]*\b4\b/)
    expect(card.textContent).not.toContain("Summed over the window's runs")
  })

  it('FULL coverage does not invent a caveat it does not have', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 2.5, measuredRuns: 4, totalRuns: 4 }) }),
        })}
      />
    )

    // The mirror of the test above: a total that DOES cover the window must not
    // be hedged into looking partial, or the disclosure stops meaning anything.
    expect(kpiCard('Cost · 24h').textContent).toContain("Summed over the window's runs")
    expect(kpiCard('Cost · 24h').textContent).not.toMatch(/measured on/i)
  })
})

/* ------------------------------------------- D4 · nothing is drawn for a null */

describe('D4 — an absent cost draws no mark: no arc, no bar, no curve', () => {
  it('the Cost card holds no drawn mark at all — and the query can see one when it exists', () => {
    // POSITIVE CONTROL FIRST. An earlier probe on this branch trusted a `<path>`
    // query against a gauge that strokes `<circle>`, so the assertion was blind
    // and green. This proves `drawnMarks` can find a mark BEFORE it is used to
    // claim there is none.
    const control = render(<ArcGauge value={42} ariaLabel="control" />)
    expect(drawnMarks(control.container).length).toBeGreaterThan(0)
    control.unmount()

    render(<OverviewScreen overview={overviewFixture({ kpis: kpis({ cost24h: null }) })} />)
    const card = kpiCard('Cost · 24h')

    expect(within(card).getByText(UNAVAILABLE)).toBeTruthy()
    expect(drawnMarks(card)).toHaveLength(0)
    expect(drawnArcs(card)).toHaveLength(0)
  })

  it('a measured cost does not smuggle a gauge in either — the figure is the whole story', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({
          kpis: kpis({ runs24h: 4, cost24h: coverage({ usd: 2.5, measuredRuns: 4, totalRuns: 4 }) }),
        })}
      />
    )

    // Stated so the null case above cannot be satisfied by a card that simply
    // never draws anything under any circumstance: the two cases differ in the
    // FIGURE, and neither carries a mark. A cost has no natural maximum, so a
    // gauge here would need an invented denominator.
    expect(drawnMarks(kpiCard('Cost · 24h'))).toHaveLength(0)
  })

  it('an absent cost never leaves a zero-length arc on a project row', () => {
    render(
      <OverviewScreen
        overview={overviewFixture({ projects: [projectItem({ runsLast24h: null, costLast24hUsd: null })] })}
      />
    )

    const panel = screen.getByText('Projects').closest('section') as HTMLElement
    expect(drawnMarks(panel)).toHaveLength(0)
  })
})

/* ------------------------------- D5 · /admin/projects states the same three */

describe('D5 — /admin/projects renders the three cost states of the same contract', () => {
  it('measured n · measured 0 · absent → "$12.50" · "$0.00" · "Indisponible"', () => {
    const { container } = render(
      <ProjectsScreen projects={CROSS_SCREEN_PROJECTS} copilots={CROSS_SCREEN_TEAM} />
    )

    const rows = registryRows(container)

    expect(rows.get('Proven')?.[4]).toBe('$12.50')
    expect(rows.get('Zero')?.[4]).toBe('$0.00')
    expect(rows.get('Dark')?.[4]).toBe(UNAVAILABLE)
    // The zero is a measurement and the absence is not — they must not collide.
    expect(rows.get('Zero')?.[4]).not.toBe(rows.get('Dark')?.[4])
  })

  it('the copilot read FAILING makes every cost absent, never 0', () => {
    const { container } = render(<ProjectsScreen projects={CROSS_SCREEN_PROJECTS} copilots={null} />)

    const rows = registryRows(container)
    expect(rows.size).toBe(3)
    for (const cells of rows.values()) {
      expect(cells[4]).toBe(UNAVAILABLE)
    }
    expect(kpiCardIn(container, 'Cost · 24h').textContent).toContain(UNAVAILABLE)
    expect(kpiCardIn(container, 'Cost · 24h').textContent).not.toContain('$')
  })

  it('a fleet where NOBODY proved a cost reports the absence, not a summed zero', () => {
    // The shared `Dark` agent, narrowed to the case this test is about: its RUN
    // count becomes a real measurement while its cost stays unproven. Derived
    // from the fixture rather than re-declared, so it stays the same agent.
    const [, , dark] = CROSS_SCREEN_TEAM
    const costUnproven: Copilot = {
      ...dark,
      healthUnavailableFields: ['costLast24hUsd'],
      health: { ...dark.health, runsLast24h: 2 },
    }

    const { container } = render(
      <ProjectsScreen projects={[CROSS_SCREEN_PROJECTS[2]]} copilots={[costUnproven]} />
    )

    const card = kpiCardIn(container, 'Cost · 24h')
    expect(within(card).getByText(UNAVAILABLE)).toBeTruthy()
    expect(card.textContent).not.toContain('$')
    // …while the metric that WAS proven on the same agent is unaffected: the two
    // fields are gated independently.
    expect(kpiCardIn(container, 'Runs · 24h').textContent).toContain('2')
  })

  /**
   * THE GATE NOTHING ELSE ON A SCREEN EXERCISES — a row that never went through
   * the data layer at all.
   *
   * `Copilot.healthUnavailableFields` is OPTIONAL, and `undefined` is its third
   * value: a raw PostgREST row cast by `camelRows` (or any path that skips
   * `enrichCopilot`) carries a full `health` blob and no statement about what
   * was proven. The contract in `types.ts` says to treat every metric as
   * unavailable there, because the blob is the stored baseline, not a reading.
   *
   * Every other fixture in this suite declares the list, so the first gate of
   * the shared rule was covered only in the data layer. It is the gate a local
   * re-implementation is most likely to get wrong — the two other gates are
   * visible in any hand-written version, this one looks like a null check that
   * "obviously" should default to trusting the numbers.
   */
  it('an UNENRICHED team (no unavailability statement at all) is absent, not its raw blob', () => {
    const [proven] = CROSS_SCREEN_TEAM
    // The same agent as `Proven` — 3 runs, $12.50 sitting in `health` — minus
    // the one thing that made those numbers measurements.
    const { healthUnavailableFields: _dropped, ...unenriched } = proven
    void _dropped

    const { container } = render(
      <ProjectsScreen projects={[CROSS_SCREEN_PROJECTS[0]]} copilots={[unenriched as Copilot]} />
    )

    const rows = registryRows(container)
    expect(rows.get('Proven')?.[3]).toBe(UNAVAILABLE) // runs
    expect(rows.get('Proven')?.[4]).toBe(UNAVAILABLE) // cost
    // The blob's numbers must not surface anywhere on the page — neither raw
    // nor formatted, and not in the KPI band above the table either.
    expect(container.textContent).not.toContain('$12.50')
    expect(kpiCardIn(container, 'Cost · 24h').textContent).not.toContain('$')
    expect(kpiCardIn(container, 'Runs · 24h').textContent).toContain(UNAVAILABLE)
  })
})

/* --------------------------------------------- D6 · the two screens agree */

describe('D6 — /admin and /admin/projects state the SAME truth for the same project', () => {
  /**
   * ONE fixture, both screens. `CROSS_SCREEN_TEAM` is the `Copilot[]`
   * `/admin/projects` receives; `CROSS_SCREEN_ITEMS` is what the data layer
   * derives from it for `/admin` — pinned by the data-layer suite (C13), so the
   * two halves of this comparison cannot drift apart silently.
   */
  function bothScreens() {
    const projectsRender = render(
      <ProjectsScreen projects={CROSS_SCREEN_PROJECTS} copilots={CROSS_SCREEN_TEAM} />
    )
    const registry = registryRows(projectsRender.container)
    projectsRender.unmount()

    const overviewRender = render(
      <OverviewScreen overview={overviewFixture({ projects: CROSS_SCREEN_ITEMS })} />
    )
    const panel = screen.getByText('Projects').closest('section') as HTMLElement
    const rows = new Map(
      [...panel.querySelectorAll('a')]
        // The panel footer holds an "All projects" link too; only the row
        // anchors point at a builder.
        .filter((row) => row.getAttribute('href')?.includes('/builder'))
        .map((row) => [row.querySelector('div.truncate')?.textContent ?? '', row.textContent ?? ''])
    )

    // NON-VACUITY. Every assertion below is a lookup, and a lookup that misses
    // would make several of them read as "the screen does not say the wrong
    // thing" — which an EMPTY screen also satisfies. Both sides must really hold
    // the three projects before anything is compared.
    expect([...registry.keys()]).toEqual(['Proven', 'Zero', 'Dark'])
    expect([...rows.keys()]).toEqual(['Proven', 'Zero', 'Dark'])

    return { registry, rows, overviewRender }
  }

  it('the RUNS figure reads identically on both screens, in all three states', () => {
    const { registry, rows } = bothScreens()

    // Proven → the same number, twice.
    expect(registry.get('Proven')?.[3]).toBe('3')
    expect(rows.get('Proven')).toContain('3')
    // Measured zero → a real 0 on both, and the word on neither.
    expect(registry.get('Zero')?.[3]).toBe('0')
    expect(rows.get('Zero')).toContain('0')
    expect(rows.get('Zero')).not.toContain(UNAVAILABLE)
    // Absent → the word on both. THIS is the pair that used to disagree: `0`
    // here and `Indisponible` there, from one field, on two screens.
    expect(registry.get('Dark')?.[3]).toBe(UNAVAILABLE)
    expect(rows.get('Dark')).toContain(UNAVAILABLE)
    expect(rows.get('Dark')).not.toMatch(/\b0\b/)
  })

  it('neither screen states a cost the other one denies', () => {
    const { registry, rows } = bothScreens()

    // `/admin/projects` is the screen that renders a per-project cost today.
    expect(registry.get('Proven')?.[4]).toBe('$12.50')
    expect(registry.get('Zero')?.[4]).toBe('$0.00')
    expect(registry.get('Dark')?.[4]).toBe(UNAVAILABLE)

    // `/admin` renders `active` and `runs` on the row and no cost — so the one
    // thing it must never do is contradict the column above. It may not print a
    // currency figure for the project whose cost nobody measured, and it may not
    // print the absence word for the two that WERE measured.
    expect(rows.get('Dark')).not.toContain('$')
    expect(rows.get('Proven')).not.toContain(UNAVAILABLE)
    expect(rows.get('Zero')).not.toContain(UNAVAILABLE)
  })

  /**
   * TRIPWIRE, not a preference. `/admin` currently shows no per-project cost at
   * all, which is why nothing there can be wrong about it — and also why the
   * fixed field is unobserved on that screen. The day a cost cell is added, this
   * test fails and the person adding it has to extend the assertions above to
   * cover it in all three states, instead of shipping a cell nobody compared.
   */
  it('TRIPWIRE — /admin does not render a per-project cost yet', () => {
    const { rows } = bothScreens()

    for (const row of rows.values()) {
      expect(row).not.toContain('$')
      expect(row).not.toContain('cost')
    }
  })
})

/* -------------------------------------------------------- recent deliveries */

function deliveryFixture(overrides: Partial<DeliveryEvent> = {}): DeliveryEvent {
  return {
    id: 'evt_1',
    mode: 'pull_request',
    targetRepo: 'adrien-debug/TradeAgent',
    targetBranch: 'main',
    deliveryBranch: 'agent/btc',
    commitSha: 'abc',
    commitUrl: 'u',
    prUrl: null,
    prNumber: null,
    status: 'completed',
    createdAt: '2026-07-20T12:34:00Z',
    ...overrides,
  }
}

describe('E — recent deliveries panel: read failed ≠ empty ≠ populated', () => {
  it('a null read (the delivery-event table could not be read) renders an error state, never an empty list', () => {
    render(<OverviewScreen overview={overviewFixture({ recentDeliveries: null })} />)

    expect(screen.getByText('Delivery events unavailable')).toBeInTheDocument()
    expect(
      screen.queryByText('No delivery has been recorded yet.')
    ).not.toBeInTheDocument()
  })

  it('a measured empty read renders the calm empty state, not the error state', () => {
    render(<OverviewScreen overview={overviewFixture({ recentDeliveries: [] })} />)

    expect(screen.getByText('No delivery has been recorded yet.')).toBeInTheDocument()
    expect(screen.queryByText('Delivery events unavailable')).not.toBeInTheDocument()
  })

  it('a populated read renders one row per delivery, newest first as given by the data layer', () => {
    const deliveries: RecentDelivery[] = [
      { copilotId: 'copilot-newer', event: deliveryFixture({ id: 'evt_new', status: 'pr_open' }) },
      { copilotId: 'copilot-older', event: deliveryFixture({ id: 'evt_old', status: 'completed' }) },
    ]
    render(<OverviewScreen overview={overviewFixture({ recentDeliveries: deliveries })} />)

    expect(screen.getByText('copilot-newer')).toBeInTheDocument()
    expect(screen.getByText('copilot-older')).toBeInTheDocument()
    expect(screen.getAllByText('adrien-debug/TradeAgent', { exact: false }).length).toBeGreaterThan(0)
  })
})
