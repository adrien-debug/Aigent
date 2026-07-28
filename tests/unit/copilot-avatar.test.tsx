import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { CopilotAvatar } from '@/components/agent-ops/copilot-avatar'
import { AGENT_BUILDER_SLUG } from '@/lib/agent-mission-control/agent-builder-copilot'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — CopilotAvatar composes Avatar.
 *
 * Previously a hand-rolled `<span>` with its own outline/radius/sizing logic.
 * These assertions pin that the rendered root still carries `Avatar`'s
 * `data-slot="avatar"` marker (proof of composition, not just visual
 * similarity) while keeping the gradient identity, icon glyph, sizing and
 * decorative accessibility CopilotAvatar owns.
 */
describe('CopilotAvatar — composes Avatar', () => {
  it('renders through the Avatar primitive (data-slot marker present)', () => {
    const { container } = render(<CopilotAvatar copilot={{ slug: 'sentinel', name: 'Sentinel', tags: [] }} />)
    expect(container.querySelector('[data-slot="avatar"]')).toBeTruthy()
  })

  it('is decorative — aria-hidden, name carried by adjacent text elsewhere', () => {
    const { container } = render(<CopilotAvatar copilot={{ slug: 'sentinel', name: 'Sentinel', tags: [] }} />)
    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('defaults to size-10 (40px) when no className override is given', () => {
    const { container } = render(<CopilotAvatar copilot={{ slug: 'sentinel', name: 'Sentinel', tags: [] }} />)
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('size-10')
  })

  it('honours a className override for sizing', () => {
    const { container } = render(
      <CopilotAvatar copilot={{ slug: 'sentinel', name: 'Sentinel', tags: [] }} className="size-6" />
    )
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('size-6')
    expect(avatar?.className).not.toContain('size-10')
  })

  it('the builder type gets the sole accent surface', () => {
    const { container } = render(
      <CopilotAvatar copilot={{ slug: AGENT_BUILDER_SLUG, name: 'Agent Builder', tags: [] }} />
    )
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('--accent-surface')
  })

  it('non-builder types are told apart by zinc shade, never a competing hue', () => {
    const { container } = render(
      <CopilotAvatar copilot={{ slug: 'sentinel', name: 'Security Sentinel', tags: ['security'] }} />
    )
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('zinc')
    expect(avatar?.className).not.toContain('--accent-surface')
  })

  it('renders the type icon inside the Avatar frame', () => {
    const { container } = render(<CopilotAvatar copilot={{ slug: 'sentinel', name: 'Sentinel', tags: [] }} />)
    expect(container.querySelector('svg')).toBeTruthy()
  })

  it('falls back to the default type/icon for an unrecognised slug', () => {
    const { container } = render(<CopilotAvatar copilot={{ slug: 'unknown-thing', name: 'Mystery', tags: [] }} />)
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar).toBeTruthy()
    expect(container.querySelector('svg')).toBeTruthy()
  })
})
