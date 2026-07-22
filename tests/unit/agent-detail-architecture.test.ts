import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * AIGENT-AGENT-PAGES-021 — the rebuilt agent detail architecture, pinned.
 *
 * These assert the ROUTE SHAPE and the value-rendering contract. Data-level
 * truth is pinned by tradeagent-reset-roster.test.ts; visual layout was checked
 * in the browser. What can silently regress here is a legacy page coming back,
 * or a null quietly rendering as 0 again.
 */

const ROOT = process.cwd()
const AGENT_ROUTE = join(ROOT, 'src/app/admin/agents/[id]')

/** The six canonical sections. Overview is the index route. */
const CANONICAL_SECTIONS = ['runs', 'tools', 'configuration', 'instructions', 'observability'] as const

/** Legacy pages folded into the six. None may return. */
const REMOVED_SECTIONS = ['manifest', 'tests', 'versions', 'improve'] as const

/** Components deleted with the legacy pages. */
const REMOVED_COMPONENTS = [
  'src/components/agent-ops/copilot-tabs.tsx',
  'src/components/agent-ops/manifest-json-preview.tsx',
  'src/components/agent-ops/manifest-summary-card.tsx',
  'src/components/agent-ops/agent-skills-card.tsx',
  'src/components/agent-ops/architecture-strip.tsx',
  'src/components/agent-ops/delivery-scorecard-card.tsx',
  'src/components/agent-ops/improve-workbench.tsx',
  'src/components/agent-ops/onboarding-steps.tsx',
  'src/components/agent-ops/sections/tests-section.tsx',
  'src/components/agent-ops/sections/versions-section.tsx',
  'src/components/agent-ops/sections/publish-section.tsx',
] as const

describe('agent detail — route architecture', () => {
  it('exposes the Overview index page', () => {
    expect(existsSync(join(AGENT_ROUTE, 'page.tsx'))).toBe(true)
  })

  it('exposes each canonical section as a real route', () => {
    for (const section of CANONICAL_SECTIONS) {
      expect(existsSync(join(AGENT_ROUTE, section, 'page.tsx')), `${section} missing`).toBe(true)
    }
  })

  it('no longer serves any legacy section', () => {
    for (const section of REMOVED_SECTIONS) {
      expect(existsSync(join(AGENT_ROUTE, section)), `${section} came back`).toBe(false)
    }
  })

  it('does not keep two implementations of the same page', () => {
    for (const file of REMOVED_COMPONENTS) {
      expect(existsSync(join(ROOT, file)), `${file} came back`).toBe(false)
    }
  })

  it('keeps the builder route, which is gated to the meta copilot', () => {
    // Not dead code: it 404s unless the copilot slug is agent-builder-copilot.
    // Removing it would delete a capability, not clean one up.
    expect(existsSync(join(AGENT_ROUTE, 'builder/page.tsx'))).toBe(true)
  })
})

describe('agent detail — value rendering contract', () => {
  it('keeps relative-time rendering pure', async () => {
    // TimeAgoValue must not CALL Date.now() in its body: it is impure, the lint
    // rule rejects it, and it would render differently on server and client.
    // Comments mentioning it are fine — strip them before asserting, otherwise
    // the doc explaining the rule trips the test that enforces it.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(ROOT, 'src/components/agent-ops/agent-detail/agent-value.tsx'), 'utf8')
    )
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
    expect(code.includes('Date.now()')).toBe(false)
    // The relative branch is opt-in: the caller supplies `now`.
    expect(src.includes('now?: number')).toBe(true)
  })

  it('exports a distinct renderer for each unmeasured dimension', async () => {
    // 0 is a measurement ("we looked, found none"); null is the absence of one.
    // Collapsing them is how "0.0% success" appeared on an agent that never ran.
    // Read as source: the module pulls in Catalyst, which is ESM-only and cannot
    // be imported under this test runner's CJS interop.
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(join(ROOT, 'src/components/agent-ops/agent-detail/agent-value.tsx'), 'utf8')
    )
    for (const fn of ['CountValue', 'RateValue', 'CostValue', 'DurationValue', 'TextValue']) {
      expect(src.includes(`export function ${fn}`), `${fn} missing`).toBe(true)
    }
    // Each must have an explicit null branch rendering the not-measured dash.
    expect(src.match(/NotMeasuredDash/g)?.length ?? 0).toBeGreaterThanOrEqual(5)
  })
})
