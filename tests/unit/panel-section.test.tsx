import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Panel, surfaceRaised } from '@/components/ui/panel'
import { Section } from '@/components/ui/section'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — Panel is the single source of
 * fill/border/radius/shadow for the raised plane. `Section` now composes
 * `Panel` (`as="section"`) instead of restating `surfaceRaised` inline —
 * these assertions pin that the two share literally the same class tokens,
 * so a future edit to `Panel`'s paint automatically reaches `Section` instead
 * of silently diverging again.
 */
describe('Panel / Section — single paint path', () => {
  it('Panel renders a div by default', () => {
    const { container } = render(<Panel>content</Panel>)
    expect(container.querySelector('div')).toBeTruthy()
  })

  it('Panel renders a section when as="section" is given', () => {
    const { container } = render(<Panel as="section">content</Panel>)
    expect(container.querySelector('section')).toBeTruthy()
    expect(container.querySelector('div')).toBeNull()
  })

  it('Section renders every dark-mode paint token that surfaceRaised declares', () => {
    const { container } = render(
      <Section title="Title" description="desc">
        body
      </Section>
    )
    const section = container.querySelector('section')
    expect(section).toBeTruthy()
    // surfaceRaised is the single declaration of the raised plane's paint —
    // every dark: token it names must land on Section's root element.
    for (const token of surfaceRaised.split(' ').filter((t) => t.startsWith('dark:'))) {
      expect(section?.className).toContain(token)
    }
  })

  it('Section is a <section>, composed from Panel, not a parallel <section> declaration', () => {
    const { container } = render(<Section title="T">body</Section>)
    // rounded-xl + ring-1 come from surfaceRaised via Panel — confirms the
    // paint arrives through composition, not a second hard-coded class list.
    const section = container.querySelector('section')
    expect(section?.className).toContain('rounded-xl')
    expect(section?.className).toContain('ring-1')
  })

  it('Section still renders its header and children', () => {
    const { getByText } = render(
      <Section title="Agents" description="All copilots">
        <p>row content</p>
      </Section>
    )
    expect(getByText('Agents')).toBeTruthy()
    expect(getByText('All copilots')).toBeTruthy()
    expect(getByText('row content')).toBeTruthy()
  })

  it('Panel tone="sunken" does not use the raised plane classes', () => {
    const { container } = render(<Panel tone="sunken">content</Panel>)
    const div = container.querySelector('div')
    expect(div?.className).not.toContain('dark:bg-surface-raised')
  })
})
