import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const push = vi.fn()

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={href} className={className} data-testid="next-link" onClick={() => push(href)}>
      {children}
    </a>
  ),
}))

import { PanelRow } from '@/components/console/screen-primitives'

describe('PanelRow navigation', () => {
  it('renders a Next Link when href is provided', () => {
    render(<PanelRow title="Agent X" href="/admin/agents/x" />)
    const link = screen.getByTestId('next-link')
    expect(link.getAttribute('href')).toBe('/admin/agents/x')
    expect(screen.getByText('Agent X')).toBeTruthy()
  })

  it('renders a plain row without href', () => {
    const { container } = render(<PanelRow title="Inert row" />)
    expect(container.querySelector('[data-testid="next-link"]')).toBeNull()
    expect(screen.getByText('Inert row')).toBeTruthy()
  })

  it('keeps trailing content visible', () => {
    render(
      <PanelRow
        title="Agent X"
        href="/admin/agents/x"
        trailing={<span data-testid="trail">blocked</span>}
      />
    )
    expect(screen.getByTestId('trail')).toBeTruthy()
  })
})
