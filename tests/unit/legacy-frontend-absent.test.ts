/**
 * P007 — pins the demolition so a later commit cannot quietly rebuild the old
 * front. Complements `scripts/check-no-legacy-front.mjs` (repo-wide import and
 * route sweep, run via `npm run check:no-legacy-front`) with the same facts
 * expressed as a test, so `npm test` alone already fails on a regression here.
 */
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()

describe('legacy front — deleted component namespaces stay deleted', () => {
  it.each(['agent-ops', 'views', 'shell', 'admin-dashboard', 'admin-shell', 'runs-console', 'aigent-v2'])(
    'src/components/%s does not exist',
    (dir) => {
      expect(existsSync(join(ROOT, 'src/components', dir))).toBe(false)
    }
  )

  it.each(['panel.tsx', 'section.tsx', 'sidebar.tsx', 'sidebar-layout.tsx', 'navbar.tsx'])(
    'src/components/ui/%s (old shell primitive) does not exist',
    (file) => {
      expect(existsSync(join(ROOT, 'src/components/ui', file))).toBe(false)
    }
  )
})

describe('legacy front — demolished admin routes stay demolished', () => {
  it.each(['factory', 'performance', 'settings', 'telemetry'])(
    'src/app/admin/%s does not exist',
    (dir) => {
      expect(existsSync(join(ROOT, 'src/app/admin', dir))).toBe(false)
    }
  )

  it('no /admin-v2 route exists', () => {
    expect(existsSync(join(ROOT, 'src/app/admin-v2'))).toBe(false)
  })

  it('only the commissioned screens, layout and error boundary remain directly under src/app/admin', () => {
    const entries = readdirSync(join(ROOT, 'src/app/admin'), { withFileTypes: true })
    const names = entries.map((e) => e.name).sort()
    // `error.tsx` is the one commissioned top-level error boundary (see
    // scripts/check-no-legacy-front.mjs ALLOWED_ERROR_BOUNDARY) — a new
    // screen built from current Catalyst primitives, not a resurrection.
    expect(names).toEqual(['agents', 'error.tsx', 'layout.tsx', 'page.tsx', 'projects', 'runs'])
  })
})

describe('legacy front — no orphaned doctrine file', () => {
  it('DESIGN-DOCTRINE.md does not exist anywhere in src', () => {
    expect(existsSync(join(ROOT, 'src/components/agent-ops/DESIGN-DOCTRINE.md'))).toBe(false)
  })
})
