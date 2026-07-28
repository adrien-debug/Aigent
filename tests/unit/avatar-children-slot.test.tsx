import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Avatar } from '@/components/ui/avatar'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — Avatar's `children` slot.
 *
 * Added so identities that are neither a photo (`src`) nor initials
 * (`initials`) — e.g. `CopilotAvatar`'s type glyph on a gradient tile — can
 * still compose the shared frame (outline, radius, sizing) instead of a
 * second hand-rolled `<span>`. Mutually exclusive in practice with
 * `src`/`initials`, same as those two already are with each other.
 */
describe('Avatar — children slot', () => {
  it('renders custom children inside the frame', () => {
    const { getByText, container } = render(
      <Avatar>
        <span>glyph</span>
      </Avatar>
    )
    expect(getByText('glyph')).toBeTruthy()
    expect(container.querySelector('[data-slot="avatar"]')).toBeTruthy()
  })

  it('keeps the frame classes (outline, radius) with custom children', () => {
    const { container } = render(
      <Avatar>
        <span>glyph</span>
      </Avatar>
    )
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('rounded-full')
    expect(avatar?.className).toContain('outline')
  })

  it('square renders the square radius variant with custom children', () => {
    const { container } = render(
      <Avatar square>
        <span>glyph</span>
      </Avatar>
    )
    const avatar = container.querySelector('[data-slot="avatar"]')
    expect(avatar?.className).toContain('rounded-(--avatar-radius)')
  })

  it('initials still render without children', () => {
    const { container } = render(<Avatar initials="AB" alt="Alice Bob" />)
    expect(container.querySelector('svg')).toBeTruthy()
    expect(container.querySelector('title')?.textContent).toBe('Alice Bob')
  })
})
