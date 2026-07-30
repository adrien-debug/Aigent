/**
 * Frontend reset — pins absence of the historical visual layer.
 * Complements `scripts/check-no-legacy-front.mjs` with test-time assertions.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('frontend reset — visual layer absent', () => {
  it('src/components does not exist', () => {
    expect(existsSync(join(ROOT, 'src/components'))).toBe(false)
  })

  it('design pilot artifacts do not exist', () => {
    expect(existsSync(join(ROOT, 'design'))).toBe(false)
  })

  it('admin UI routes do not exist', () => {
    expect(existsSync(join(ROOT, 'src/app/admin'))).toBe(false)
  })

  it('marketing site routes do not exist', () => {
    expect(existsSync(join(ROOT, 'src/app/(site)'))).toBe(false)
  })

  it('theme tokens file does not exist', () => {
    expect(existsSync(join(ROOT, 'src/theme.css'))).toBe(false)
  })

  it('minimal skeleton page exists', () => {
    expect(existsSync(join(ROOT, 'src/app/page.tsx'))).toBe(true)
  })
})
