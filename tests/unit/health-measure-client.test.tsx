/**
 * Component-project tests — the shared measurement rule is CLIENT-SAFE, and it
 * gives the browser exactly the same answers it gives the server.
 *
 * ─── WHY THIS FILE EXISTS AT ALL ────────────────────────────────────────────
 *
 * `src/lib/agent-mission-control/health-measure.ts` is a module carved out of
 * `dashboard-overview.ts` for ONE reason: that file opens with
 * `import 'server-only'`, and taking a VALUE from it drags the guard into the
 * runtime graph of whoever imports it. `/admin/projects`
 * (`src/components/console/projects-screen.tsx`) needs the rule and is a React
 * component, so on an earlier branch the value import made this very suite die
 * at load time with "This module cannot be imported from a Client Component".
 * The answer taken was neither a second copy of the rule nor business logic
 * moved into a component, but a NEUTRAL module — and "neutral" is a claim about
 * a module graph, which only an actual import under browser resolve conditions
 * can settle.
 *
 * The `.tsx` extension is load-bearing: `vitest.config.ts` routes
 * `tests/unit/**\/*.test.ts` to the `unit` project (node, `react-server`
 * conditions, where `server-only` resolves to an EMPTY module and proves
 * nothing) and `tests/unit/**\/*.test.tsx` to `components` (happy-dom, BROWSER
 * conditions, where it resolves to the module that throws). Renaming this file
 * to `.ts` would move it to the project that cannot see the defect.
 *
 * ─── HOW THE PROOF IS MADE NON-VACUOUS ──────────────────────────────────────
 *
 * A passing import only means something if a NON-neutral import would have
 * failed here. So the last test is a positive control: it imports
 * `dashboard-overview.ts` in this same project and asserts it DOES throw the
 * server-only error. Without it, this file would still be green in a
 * configuration where the guard had been switched off entirely.
 *
 * THE IMPORT BELOW IS THE FIRST ASSERTION. It is a static, top-of-file VALUE
 * import — the same kind `projects-screen.tsx` makes. If the module ever picks
 * up `server-only`, `next/*`, the data layer or anything reaching PostgREST,
 * this file stops loading and every test in it fails before a single assertion
 * runs. That failure IS the regression signal.
 */
import { describe, expect, it } from 'vitest'

import { isMeasuredHealth, sumMeasuredHealth } from '@/lib/agent-mission-control/health-measure'

import {
  MEASURED_METRICS,
  MEASUREMENT_STATES,
  measureCopilot,
} from '../fixtures/health-measure-states'

describe('the shared measurement rule is importable from a Client Component', () => {
  it('the VALUE import at the top of this file resolved — no server-only rode along', () => {
    // Reached only because the module loaded under browser conditions. The
    // assertions are about identity, not behaviour: behaviour is the next
    // describe, and this one exists to name what the import itself proved.
    expect(typeof isMeasuredHealth).toBe('function')
    expect(typeof sumMeasuredHealth).toBe('function')
  })

  it('and it still works here, on a real copilot — not just a resolvable symbol', () => {
    const measured = measureCopilot({
      id: 'c1',
      runsLast24h: 4,
      costLast24hUsd: 2.5,
      healthUnavailableFields: [],
    })
    expect(isMeasuredHealth(measured, 'runsLast24h')).toBe(true)
    expect(sumMeasuredHealth([measured], 'costLast24hUsd')).toEqual({ value: 2.5, measured: 1, unmeasured: 0 })
  })
})

/**
 * THE SAME TABLE the `unit` project asserts (`tests/unit/health-measure.test.ts`),
 * against the SAME function, under DIFFERENT resolve conditions.
 *
 * One rule, one set of answers, two runtimes: this is what "the screen and the
 * data layer can no longer disagree about what `measured` means" actually
 * reduces to. Written once in `tests/fixtures/health-measure-states.ts` — two
 * hand-written copies of the expected values would re-create, in the tests, the
 * duplication the module removed.
 */
describe('the five states resolve identically under browser conditions', () => {
  for (const state of MEASUREMENT_STATES) {
    for (const { metric, key } of MEASURED_METRICS) {
      it(`${state.name} · ${metric}`, () => {
        const sum = sumMeasuredHealth(state.team, metric)
        expect(sum).toEqual(state.expected[key])

        if (state.isAbsent) {
          // An absent measurement is `null`, and never a zero-valued sum — the
          // distinction `/admin/projects` turns into `Indisponible` vs `$0.00`.
          expect(sum).toBeNull()
        } else {
          if (sum === null) throw new Error('a measured state must not return null')
          expect(sum.measured + sum.unmeasured).toBe(state.team.length)
        }
      })
    }
  }
})

describe('POSITIVE CONTROL — this project really does enforce the server-only guard', () => {
  it('a VALUE import of the server-only data layer throws here, so the clean import above means something', async () => {
    let thrown: Error | null = null
    try {
      await import('@/lib/agent-mission-control/dashboard-overview')
    } catch (error) {
      thrown = error as Error
    }

    // The exact error the earlier branch died with. If this test ever goes
    // green-by-not-throwing, the guard has been disabled and the "client-safe"
    // claim made by the tests above is no longer evidence of anything.
    expect(thrown).not.toBeNull()
    expect(thrown?.message).toContain('cannot be imported from a Client Component')
  })

  it('…while a TYPE-only import of that same module costs nothing at runtime', () => {
    // `tests/fixtures/cross-screen-cost.ts` takes `ProjectOverviewItem` from the
    // server-only module and is imported by this project without incident,
    // because a type import is erased before it reaches the module graph. Named
    // here so the control above is not misread as "that file is untouchable".
    const item: import('@/lib/agent-mission-control/dashboard-overview').ProjectOverviewItem = {
      id: 'p1',
      name: 'P1',
      imageUrl: null,
      logoUrl: null,
      repoFullName: null,
      platform: 'web',
      copilotCount: 0,
      activeCount: 0,
      runsLast24h: null,
      costLast24hUsd: null,
      passRate: null,
    }
    expect(item.costLast24hUsd).toBeNull()
  })
})
