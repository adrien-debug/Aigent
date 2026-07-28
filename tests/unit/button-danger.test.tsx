import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Button } from '@/components/ui/button'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — the `danger` colour variant.
 *
 * Replaces four copy-pasted inline `--btn-*` overrides (release-panel.tsx,
 * delete-project-dialog.tsx, project-delete-action.tsx,
 * project-team-relation-dialogs.tsx). These assertions pin the variant's
 * contract so a future edit cannot silently drop it back to per-component
 * inline styles.
 */
describe('Button — danger variant', () => {
  it('applies the danger role tokens (fill, border, text)', () => {
    render(<Button color="danger">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.className).toContain('[--btn-bg:var(--state-danger-solid)]')
    expect(button.className).toContain('[--btn-border:var(--state-danger-solid-line)]')
    expect(button.className).toContain('text-white')
  })

  it('sets the icon role via --btn-icon', () => {
    render(<Button color="danger">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.className).toContain('[--btn-icon:var(--color-white)]')
  })

  it('keeps focus-visible affordance from the shared base styles', () => {
    render(<Button color="danger">Delete</Button>)
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button.className).toContain('data-focus:outline-2')
    expect(button.className).toContain('data-focus:outline-accent-500')
  })

  it('supports disabled state via the shared base styles', () => {
    render(
      <Button color="danger" disabled>
        Delete
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    expect(button.className).toContain('data-disabled:opacity-50')
  })

  it('fires onClick like any other colour', () => {
    const onClick = vi.fn()
    render(
      <Button color="danger" onClick={onClick}>
        Delete
      </Button>
    )
    screen.getByRole('button', { name: 'Delete' }).click()
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('plain + dangerIcon paints only the icon role, not a solid fill', () => {
    render(
      <Button plain dangerIcon>
        Delete…
      </Button>
    )
    const button = screen.getByRole('button', { name: 'Delete…' })
    expect(button.className).toContain('[--btn-icon:var(--state-danger-text)]')
    // `plain`'s neutral fill/border stays — no --btn-bg override for a solid red.
    expect(button.className).not.toContain('--btn-bg:var(--state-danger-solid)')
  })

  it('renders as a link when href is provided, keeping the danger classes', () => {
    render(
      <Button color="danger" href="/admin/projects/p1">
        Delete project
      </Button>
    )
    const link = screen.getByRole('link', { name: 'Delete project' })
    expect(link).toHaveAttribute('href', '/admin/projects/p1')
    expect(link.className).toContain('[--btn-bg:var(--state-danger-solid)]')
  })
})
