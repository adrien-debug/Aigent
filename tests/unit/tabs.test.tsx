import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

let mockPathname = '/admin/projects/p1'

import { Tabs } from '@/components/ui/tabs'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — canonical tab-nav primitive.
 *
 * Replaces two near-identical implementations (`ProjectTabs`, `AgentDetailNav`
 * — see the migrated files, which now compose this instead). Both the current-
 * tab indicator and the scroll-affordance behaviour are pinned here; the
 * `data-tabs-group` id exists specifically to prevent a future collision if
 * two `Tabs` instances render on one page and gain a `layoutId`-based
 * indicator later.
 */
const ITEMS = [
  { label: 'Overview', segment: '' },
  { label: 'Agent Builder', segment: 'builder' },
  { label: 'My Team', segment: 'team' },
] as const

describe('Tabs', () => {
  it('renders one link per item with the correct hrefs', () => {
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(screen.getByRole('link', { name: 'Overview' })).toHaveAttribute('href', '/admin/projects/p1')
    expect(screen.getByRole('link', { name: 'Agent Builder' })).toHaveAttribute(
      'href',
      '/admin/projects/p1/builder'
    )
    expect(screen.getByRole('link', { name: 'My Team' })).toHaveAttribute('href', '/admin/projects/p1/team')
  })

  it('marks the tab matching the current pathname as aria-current', () => {
    mockPathname = '/admin/projects/p1/builder'
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(screen.getByRole('link', { name: 'Agent Builder' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    mockPathname = '/admin/projects/p1'
  })

  it('marks a nested route as current via startsWith, not exact match', () => {
    mockPathname = '/admin/projects/p1/builder/step-2'
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(screen.getByRole('link', { name: 'Agent Builder' })).toHaveAttribute('aria-current', 'page')
    mockPathname = '/admin/projects/p1'
  })

  it('the base route matches only exactly, not every sub-route', () => {
    mockPathname = '/admin/projects/p1/team'
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('link', { name: 'My Team' })).toHaveAttribute('aria-current', 'page')
    mockPathname = '/admin/projects/p1'
  })

  it('uses the given ariaLabel on the nav landmark', () => {
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(screen.getByRole('navigation', { name: 'Project sections' })).toBeTruthy()
  })

  it('links carry focus-visible outline classes for keyboard navigation', () => {
    render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    const link = screen.getByRole('link', { name: 'Overview' })
    expect(link.className).toContain('focus-visible:outline-2')
    expect(link.className).toContain('focus-visible:outline-accent-500')
  })

  it('two Tabs instances on one page get distinct group ids (no layoutId collision)', () => {
    render(
      <>
        <Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />
        <Tabs
          items={[{ label: 'Runs', segment: 'runs' }, { label: 'Tools', segment: 'tools' }] as const}
          base="/admin/agents/a1"
          ariaLabel="Agent sections"
        />
      </>
    )
    const navs = screen.getAllByRole('navigation')
    expect(navs).toHaveLength(2)
    const groupIds = navs.map((nav) => nav.getAttribute('data-tabs-group'))
    expect(groupIds[0]).toBeTruthy()
    expect(groupIds[1]).toBeTruthy()
    expect(groupIds[0]).not.toBe(groupIds[1])
  })

  it('scrollAffordance off (default): no absolutely-positioned edge fades', () => {
    const { container } = render(<Tabs items={ITEMS} base="/admin/projects/p1" ariaLabel="Project sections" />)
    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(0)
  })

  it('scrollAffordance on: nav renders inside a relative wrapper ready for edge fades', () => {
    const { container } = render(
      <Tabs items={ITEMS} base="/admin/agents/a1" ariaLabel="Agent sections" scrollAffordance />
    )
    const wrapper = container.firstElementChild
    expect(wrapper?.className).toContain('relative')
  })
})
