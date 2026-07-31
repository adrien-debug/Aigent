/**
 * Front démoli — épingle l'absence des surfaces supprimées.
 * Complète `scripts/check-no-legacy-front.mjs` par des assertions au test.
 *
 * `src/components/` n'est PLUS asserté absent : le front est en reconstruction
 * depuis le 2026-07-31 (premier bloc UI, sur ordre explicite d'Adrien). Ce qui
 * reste épinglé, c'est ce qui a été supprimé pour de bonnes raisons et ne doit
 * pas ressusciter en silence.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('front démoli — les surfaces supprimées restent absentes', () => {
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

  it('the old console component tree does not exist', () => {
    expect(existsSync(join(ROOT, 'src/components/console'))).toBe(false)
  })

  it('skeleton page and layout exist', () => {
    expect(existsSync(join(ROOT, 'src/app/page.tsx'))).toBe(true)
    expect(existsSync(join(ROOT, 'src/app/layout.tsx'))).toBe(true)
  })
})
