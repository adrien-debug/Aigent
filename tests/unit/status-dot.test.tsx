import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { StatusDot } from '@/components/ui/status-dot'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — canonical "dot + label" status.
 *
 * Replaces three byte-identical implementations (`CheckStatusText`,
 * `StepStatusText`, `PromotionStatusText`). The word must always carry the
 * distinction — the dot alone is decorative — so every assertion checks the
 * text is present and readable by assistive tech, not just that a colour
 * class exists.
 */
describe('StatusDot', () => {
  it('renders the positive tone with an accent-filled dot', () => {
    const { container } = render(<StatusDot tone="positive">Pass</StatusDot>)
    expect(screen.getByText('Pass')).toBeTruthy()
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot?.className).toContain('bg-accent-500')
  })

  it('renders the negative tone with the danger role, never the accent', () => {
    const { container } = render(<StatusDot tone="negative">Fail</StatusDot>)
    expect(screen.getByText('Fail')).toBeTruthy()
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot?.className).toContain('--state-danger-solid')
    expect(dot?.className).not.toContain('accent')
  })

  it('renders the neutral tone as an unfilled ring, not a solid colour', () => {
    const { container } = render(<StatusDot tone="neutral">Not measured</StatusDot>)
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot?.className).toContain('ring-1')
    expect(dot?.className).not.toContain('bg-accent')
    expect(dot?.className).not.toContain('--state-danger')
  })

  it('renders the pending tone distinctly from both outcomes', () => {
    const { container } = render(<StatusDot tone="pending">Running</StatusDot>)
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot?.className).not.toContain('accent')
    expect(dot?.className).not.toContain('--state-danger')
  })

  it('renders every documented tone without throwing', () => {
    const tones = ['positive', 'negative', 'neutral', 'pending'] as const
    for (const tone of tones) {
      const { unmount } = render(<StatusDot tone={tone}>{tone}</StatusDot>)
      expect(screen.getByText(tone)).toBeTruthy()
      unmount()
    }
  })

  it('the dot is aria-hidden — the label is what assistive tech reads', () => {
    const { container } = render(<StatusDot tone="positive">Pass</StatusDot>)
    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).toBeTruthy()
    // The label text itself must be in the accessible tree (not aria-hidden).
    const label = screen.getByText('Pass')
    expect(label.closest('[aria-hidden="true"]')).toBeNull()
  })

  it('accepts an explicit srLabel that overrides the spoken text', () => {
    render(
      <StatusDot tone="negative" srLabel="Test suite failed">
        Fail
      </StatusDot>
    )
    expect(screen.getByText('Test suite failed')).toBeTruthy()
    expect(screen.getByText('Fail')).toBeTruthy()
  })

  it('supports the sm and md sizes', () => {
    const { container: sm } = render(
      <StatusDot tone="positive" size="sm">
        Pass
      </StatusDot>
    )
    const { container: md } = render(
      <StatusDot tone="positive" size="md">
        Pass
      </StatusDot>
    )
    expect(sm.querySelector('[aria-hidden="true"]')?.className).toContain('size-1.5')
    expect(md.querySelector('[aria-hidden="true"]')?.className).toContain('size-2')
  })
})
