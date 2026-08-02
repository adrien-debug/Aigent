import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))))
const GATE = join(ROOT, 'scripts/check-theme-foundation.mjs')

function runGate() {
  return spawnSync(process.execPath, [GATE], { cwd: ROOT, encoding: 'utf8' })
}

describe('AIGENT-DS-REFACTOR-001 theme foundation', () => {
  it('passe la gate check:theme-foundation', () => {
    const res = runGate()
    expect(res.status, res.stderr || res.stdout).toBe(0)
  })

  it('conserve les élévations canoniques inchangées', () => {
    const tokens = readFileSync(join(ROOT, 'src/theme/tokens.css'), 'utf8')
    expect(tokens).toContain('--aig-elevation-flat: inset 0 1px 0 oklch(1 0 0 / 0.04)')
    expect(tokens).toContain(
      '--aig-elevation-raised:\n    inset 0 1px 0 oklch(1 0 0 / 0.05), 0 1px 2px oklch(0 0 0 / 0.4)',
    )
  })

  it('recâble le rayon produit sur 8px (--radius-md)', () => {
    const tokens = readFileSync(join(ROOT, 'src/theme/tokens.css'), 'utf8')
    expect(tokens).toContain('--radius-md: 0.5rem')
    expect(tokens).toContain('--aig-radius: var(--radius-md)')
  })
})
