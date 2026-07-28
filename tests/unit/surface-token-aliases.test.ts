import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001 — surface token alias contract.
 *
 * `--color-surface-canvas`/`-secondary`/`-interactive`/`-elevated` were three
 * independent hex literals that happened to match their `--color-surface-
 * app`/`-raised`/`-overlay` counterparts — one accidental edit from silently
 * diverging. They are now declared as `var(...)` of the canonical token, so
 * this parses theme.css textually (no DOM/CSSOM available in the `unit`
 * project) and pins: every legacy alias still resolves to a token declared in
 * this file, and `--color-surface-primary` / `--color-surface-focus` — kept
 * as genuinely distinct values, not aliased — still carry a real hex literal
 * rather than having been silently folded into the ladder.
 */
const THEME_CSS = readFileSync(join(__dirname, '../../src/theme.css'), 'utf8')

function declaredValue(token: string): string | null {
  const re = new RegExp(`--${token}:\\s*([^;]+);`)
  const match = THEME_CSS.match(re)
  return match ? match[1].trim() : null
}

describe('theme.css — surface token aliases', () => {
  const ALIASES: Array<[legacy: string, canonical: string]> = [
    ['color-surface-canvas', 'color-surface-app'],
    ['color-surface-secondary', 'color-surface-raised'],
    ['color-surface-interactive', 'color-surface-overlay'],
    ['color-surface-elevated', 'color-surface-overlay'],
  ]

  it.each(ALIASES)('--%s is declared as var(--%s)', (legacy, canonical) => {
    const value = declaredValue(legacy)
    expect(value).toBe(`var(--${canonical})`)
  })

  it('every alias target is itself declared with a real value in theme.css', () => {
    const canonicalTokens = ['color-surface-app', 'color-surface-raised', 'color-surface-overlay']
    for (const token of canonicalTokens) {
      const value = declaredValue(token)
      expect(value, `--${token} must be declared`).toBeTruthy()
      expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })

  it('--color-surface-primary is kept as a distinct hex literal, not aliased', () => {
    const value = declaredValue('color-surface-primary')
    expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    expect(value).not.toBe('var(--color-surface-workspace)')
    // Confirms it is genuinely distinct from the nearest ladder step, not a
    // near-miss that should have been the same alias.
    expect(value).not.toBe(declaredValue('color-surface-workspace'))
  })

  it('--color-surface-focus is kept as a distinct hex literal, not aliased', () => {
    const value = declaredValue('color-surface-focus')
    expect(value).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('documents a canonical replacement for every aliased legacy token', () => {
    // The migration table in theme.css must list all four aliases — this
    // guards the doc from rotting out of sync with the declarations above.
    for (const [legacy] of ALIASES) {
      const dashed = `--${legacy}`
      expect(THEME_CSS.includes(dashed), `theme.css must document ${dashed} in the migration table`).toBe(true)
    }
  })
})
