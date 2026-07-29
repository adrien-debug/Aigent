/**
 * The console FRAME — one shell, four real destinations, and no word the
 * destination cannot honour.
 *
 * `ConsoleShell` is the only thing every admin screen shares, so it is also the
 * only place a lie is rendered six times over. Three classes of defect are
 * pinned here, each one measured in the audit before it was fixed:
 *
 *  1. A LABEL THE DESTINATION CANNOT BACK. The quick-access control said "Live
 *     runs" while `/admin/runs` is a per-request server render — no
 *     `EventSource`, no polling, no `revalidate` anywhere under `src/`, and a
 *     "Read at <t> UTC" footer that exists precisely because it is a snapshot.
 *     The word is asserted here, and the *absence* of the word "Live" with it:
 *     renaming the control back would go red.
 *  2. A DEAD CONTROL. Every rail entry must be a route that exists ON DISK.
 *     That is checked against the filesystem rather than against a copy of the
 *     list, so adding an entry without adding the page fails.
 *  3. AN INVENTED MEASUREMENT. No state ⇒ no dot. A dot is drawn only when a
 *     route supplies a label or declares degradation.
 *
 * `ConsoleShell` is a server component with no state, no effect and no data
 * read, so RTL renders it directly.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ConsoleShell } from '@/components/console/console-shell'

const ROOT = process.cwd()

/** The four sections the rail advertises, and the file each one must resolve to. */
const SECTIONS = [
  { label: 'Overview', href: '/admin', page: 'src/app/admin/page.tsx' },
  { label: 'Runs', href: '/admin/runs', page: 'src/app/admin/runs/page.tsx' },
  { label: 'Projects', href: '/admin/projects', page: 'src/app/admin/projects/page.tsx' },
  { label: 'Agents', href: '/admin/agents', page: 'src/app/admin/agents/page.tsx' },
] as const

function shell(props: Parameters<typeof ConsoleShell>[0] extends never ? never : Partial<Parameters<typeof ConsoleShell>[0]> = {}) {
  return render(
    <ConsoleShell activeHref="/admin" title="Overview" {...props}>
      <p>screen content</p>
    </ConsoleShell>
  )
}

/** The full-height rail (`aria-label="Primary"`), not the compact strip. */
function rail(container: HTMLElement): HTMLElement {
  const nav = container.querySelector('nav[aria-label="Primary"]')
  if (nav === null) throw new Error('The primary rail did not render')
  return nav as HTMLElement
}

/* ------------------------------------------------------------------ E1 */

describe('E1 — one shell, one content column, one navigation source', () => {
  it('renders exactly ONE rail, ONE compact strip and ONE main region', () => {
    const { container } = shell()

    expect(container.querySelectorAll('nav[aria-label="Primary"]')).toHaveLength(1)
    expect(container.querySelectorAll('nav[aria-label="Primary (compact)"]')).toHaveLength(1)
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelectorAll('header')).toHaveLength(1)
  })

  it('renders the screen it was handed, inside that one main region', () => {
    const { container } = shell()
    const main = container.querySelector('main')
    expect(within(main as HTMLElement).getByText('screen content')).toBeTruthy()
  })

  it('the compact strip repeats the SAME four entries — no second route table', () => {
    const { container } = shell()
    const compact = container.querySelector('nav[aria-label="Primary (compact)"]') as HTMLElement

    const railHrefs = [...rail(container).querySelectorAll('a')].map((a) => a.getAttribute('href'))
    const compactHrefs = [...compact.querySelectorAll('a')].map((a) => a.getAttribute('href'))
    expect(compactHrefs).toEqual(railHrefs)
    expect(railHrefs).toEqual(SECTIONS.map((section) => section.href))
  })
})

/* ------------------------------------------------------------------ E2 */

describe('E2 — every advertised destination is a route that exists on disk', () => {
  it.each(SECTIONS)('$label → $href is backed by $page', ({ label, href, page }) => {
    const { container } = shell()
    const link = within(rail(container)).getByRole('link', { name: label })
    expect(link.getAttribute('href')).toBe(href)
    expect(existsSync(join(ROOT, page))).toBe(true)
  })

  it('no control anywhere in the frame points at a demolished or invented route', () => {
    const { container } = shell({ activeHref: '/admin/projects' })
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '')

    // `/admin-v2` is the route family `scripts/check-no-legacy-front.mjs`
    // forbids outright; the other three were demolished with their screens.
    for (const dead of ['/admin-v2', '/admin/factory', '/admin/performance', '/admin/settings']) {
      expect(hrefs.some((href) => href.startsWith(dead))).toBe(false)
    }
    // And nothing is a placeholder: an `href` of `#`, `null` or the empty string
    // is a control that goes nowhere.
    expect(hrefs.every((href) => href.length > 0 && href !== '#')).toBe(true)
  })

  it('Sign out is a PLAIN anchor to the real /logout handler, never a prefetching link', () => {
    const { container } = shell()
    const signOut = screen.getByRole('link', { name: 'Sign out' })

    expect(signOut.getAttribute('href')).toBe('/logout')
    expect(existsSync(join(ROOT, 'src/app/logout/route.ts'))).toBe(true)
    // next/link would PREFETCH it and sign the operator out on hover, so this
    // one control is deliberately outside the rail's `Link` list.
    expect(within(rail(container)).queryByRole('link', { name: 'Sign out' })).toBeNull()
  })
})

/* ------------------------------------------------------------------ E3 */

describe('E3 — the quick-access control says what its destination can honour', () => {
  it('is labelled "Run activity" and never claims anything is live', () => {
    const { container } = shell({ activeHref: '/admin' })

    const control = screen.getByRole('link', { name: /Run activity/ })
    expect(control.getAttribute('href')).toBe('/admin/runs')

    // THE ANTI-REGRESSION. `/admin/runs` streams nothing; the whole frame must
    // not contain the word.
    expect(container.textContent).not.toMatch(/\bLive\b/i)
  })

  it('is SUPPRESSED on the runs section itself — a self-link is a no-op dressed as an action', () => {
    const onRuns = shell({ activeHref: '/admin/runs' })
    expect(within(onRuns.container.querySelector('header') as HTMLElement).queryByRole('link', { name: /Run activity/ })).toBeNull()
    onRuns.unmount()

    // …and it is back everywhere else, so nothing was silently deleted.
    const onAgents = shell({ activeHref: '/admin/agents' })
    expect(within(onAgents.container.querySelector('header') as HTMLElement).getByRole('link', { name: /Run activity/ })).toBeTruthy()
  })
})

/* ------------------------------------------------------------------ E4 */

describe('E4 — the active pill marks one section, and the right one', () => {
  it('/admin lights Overview EXACTLY, and no other entry', () => {
    const { container } = shell({ activeHref: '/admin' })
    const current = [...rail(container).querySelectorAll('[aria-current="page"]')]
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain('Overview')
  })

  it.each([
    ['/admin/agents/copilot-market-intelligence', 'Agents'],
    ['/admin/projects/proj-tradeagent/builder', 'Projects'],
    ['/admin/runs', 'Runs'],
  ])('%s lights %s by longest prefix', (path, expected) => {
    const { container } = shell({ activeHref: path })
    const current = [...rail(container).querySelectorAll('[aria-current="page"]')]
    expect(current).toHaveLength(1)
    expect(current[0].textContent).toContain(expected)
  })

  it('a detail route does NOT also light Overview (which prefixes every entry)', () => {
    const { container } = shell({ activeHref: '/admin/agents/copilot-x' })
    const overview = within(rail(container)).getByRole('link', { name: 'Overview' })
    expect(overview.getAttribute('aria-current')).toBeNull()
  })

  it('no activeHref ⇒ no pill is lit at all', () => {
    const { container } = shell({ activeHref: undefined })
    expect(rail(container).querySelectorAll('[aria-current="page"]')).toHaveLength(0)
  })
})

/* ------------------------------------------------------------------ E5 */

describe('E5 — the platform dot is a measurement, never decoration', () => {
  it('no label and no degradation ⇒ NO dot is drawn', () => {
    const { container } = shell({ stateLabel: undefined, degraded: false })
    const header = container.querySelector('header') as HTMLElement
    expect(within(header).queryByText(/reporting|degraded|Partial/i)).toBeNull()
  })

  it('a label renders verbatim, in the positive role when nothing is degraded', () => {
    shell({ stateLabel: 'No data-source warning reported' })
    expect(screen.getByText('No data-source warning reported')).toBeTruthy()
  })

  it('degradation without a word still surfaces — in the danger role, never dropped', () => {
    const { container } = shell({ stateLabel: undefined, degraded: true })
    const header = container.querySelector('header') as HTMLElement
    // Not the bare word "Degraded": that belongs to the AGENT status vocabulary.
    expect(within(header).getByText('Service degraded')).toBeTruthy()
  })

  it('a degraded label is not painted in the accent', () => {
    const { container } = shell({ stateLabel: 'Agent catalogue unreadable', degraded: true })
    const dot = screen.getByText('Agent catalogue unreadable').closest('span')
    const markup = (dot?.outerHTML ?? '') + (container.querySelector('header')?.innerHTML ?? '')
    expect(markup).toMatch(/state-danger/)
    expect(dot?.outerHTML ?? '').not.toMatch(/accent-500|--chart-line/)
  })
})

/* ------------------------------------------------------------------ E6 */

describe('E6 — the rail is compact at intermediate widths and never floats', () => {
  it('the track steps 216px → 248px instead of jumping straight to 248', () => {
    const { container } = shell()
    const grid = container.querySelector('div.grid.min-h-screen') as HTMLElement
    const classes = grid.getAttribute('class') ?? ''

    expect(classes).toContain('lg:grid-cols-[216px_minmax(0,1fr)]')
    expect(classes).toContain('xl:grid-cols-[248px_minmax(0,1fr)]')
    // THE REGRESSION THIS PINS: a single 248px track from `lg` up spent 24.2%
    // of a 1024px viewport on four short links.
    expect(classes).not.toMatch(/lg:grid-cols-\[248px/)
  })

  it('the width cap sits on the CONTENT, not on the frame, so the rail stays flush left', () => {
    const { container } = shell()
    const grid = container.querySelector('div.grid.min-h-screen') as HTMLElement
    // A cap on the grid centres the whole frame and detaches the graphite rail
    // from the left edge above the cap — a rendering fault, not a layout choice.
    expect(grid.getAttribute('class') ?? '').not.toMatch(/max-w-\[\d+px\]/)

    const main = container.querySelector('main') as HTMLElement
    expect(main.getAttribute('class') ?? '').toContain('max-w-[1552px]')
  })
})
