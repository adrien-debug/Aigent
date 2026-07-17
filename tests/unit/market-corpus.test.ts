/**
 * AIG-TRADE-001 — LOT 4: meta-coherence test for the trading corpus.
 *
 * This test executes NO agent, calls NO OpenAI, and hits NO network. It is a
 * pure structural check that the hand-authored corpus in `market/eval/corpus.ts`
 * is internally consistent and honours the mission invariants BEFORE any runner
 * ever replays it:
 *   - every agentSlug is a real roster slug;
 *   - each split (train/tune/validation) is non-empty;
 *   - there are at least 5 adversarial cases;
 *   - every 'safety' case asserts a refusal or an abstention;
 *   - every referenced fixtureScenario exists;
 *   - no temporal leak: every asOf <= the frozen leak ceiling;
 *   - 'incomplete' cases aim at UNAVAILABLE/abstention.
 */

import { describe, expect, it } from 'vitest'

import {
  TRADING_CORPUS,
  TRADING_AGENT_SLUGS,
  CORPUS_ASOF_CEILING,
  casesForAgent,
  casesBySplit,
  adversarialCases,
  type TradingAgentSlug,
  type ExpectedBehavior,
} from '../../src/lib/agent-mission-control/market/eval/corpus'
import { SCENARIOS } from '../../src/lib/agent-mission-control/market/fixtures/scenarios'
import { ROSTER } from '../../src/lib/agent-mission-control/market/agents/roster'

// The real roster is the source of truth for slugs — a corpus case that names
// an agent the roster does not define is a bug. Static import; hard cross-check.
const ROSTER_SLUGS: readonly string[] = ROSTER.map((a) => a.slug)

const KNOWN_SCENARIOS = new Set(Object.keys(SCENARIOS))

/** True if this behaviour list makes the agent refuse or abstain. */
function refusesOrAbstains(behaviors: ExpectedBehavior[]): boolean {
  return behaviors.some(
    (b) =>
      b.kind === 'must-refuse-action' ||
      b.kind === 'must-abstain' ||
      b.kind === 'must-be-unavailable',
  )
}

describe('trading corpus — meta coherence', () => {
  it('is non-trivial (>= 30 cases)', () => {
    expect(TRADING_CORPUS.length).toBeGreaterThanOrEqual(30)
  })

  it('every case has a unique id', () => {
    const ids = TRADING_CORPUS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('every agentSlug is a known roster slug', () => {
    const allowed = new Set<string>(ROSTER_SLUGS)
    for (const c of TRADING_CORPUS) {
      expect(allowed.has(c.agentSlug), `unknown slug: ${c.agentSlug} in ${c.id}`).toBe(true)
    }
  })

  it('the corpus literal slugs match the roster exactly', () => {
    for (const slug of TRADING_AGENT_SLUGS) {
      expect(ROSTER_SLUGS, `corpus slug missing from roster: ${slug}`).toContain(slug)
    }
    // ...and the roster defines no agent the corpus forgot to cover.
    for (const slug of ROSTER_SLUGS) {
      expect(TRADING_AGENT_SLUGS as readonly string[]).toContain(slug)
    }
  })

  it('every split is non-empty', () => {
    for (const split of ['train', 'tune', 'validation'] as const) {
      expect(casesBySplit(split).length, `empty split: ${split}`).toBeGreaterThan(0)
    }
  })

  it('every roster slug has at least one case', () => {
    for (const slug of TRADING_AGENT_SLUGS as readonly TradingAgentSlug[]) {
      expect(casesForAgent(slug).length, `no case for ${slug}`).toBeGreaterThan(0)
    }
  })

  it('has at least 5 adversarial (safety) cases', () => {
    expect(adversarialCases().length).toBeGreaterThanOrEqual(5)
  })

  it('every safety case refuses an action or abstains, and is locked in validation', () => {
    for (const c of adversarialCases()) {
      expect(c.category).toBe('safety')
      expect(c.split, `safety case not in validation: ${c.id}`).toBe('validation')
      expect(refusesOrAbstains(c.expectedBehavior), `safety case not a refusal/abstention: ${c.id}`).toBe(true)
      // A safety case must NEVER assert a financial action succeeds.
      const asserted = c.expectedBehavior.map((b) => b.kind)
      expect(asserted, `safety case asserts field-equals lean bullish/bearish: ${c.id}`).not.toContain(
        'field-equals-buy',
      )
    }
  })

  it('references only known fixtureScenarios', () => {
    for (const c of TRADING_CORPUS) {
      const s = c.input.fixtureScenario
      if (s !== undefined) {
        expect(KNOWN_SCENARIOS.has(s), `unknown fixtureScenario: ${s} in ${c.id}`).toBe(true)
      }
    }
  })

  it('has NO temporal leak: every asOf <= the frozen leak ceiling', () => {
    for (const c of TRADING_CORPUS) {
      expect(
        c.input.asOf,
        `temporal leak: ${c.id} asOf ${c.input.asOf} > ceiling ${CORPUS_ASOF_CEILING}`,
      ).toBeLessThanOrEqual(CORPUS_ASOF_CEILING)
    }
  })

  it('fixture-backed cases pin asOf to their scenario close time (no future candles)', () => {
    for (const c of TRADING_CORPUS) {
      const s = c.input.fixtureScenario
      if (s !== undefined && s in SCENARIOS) {
        expect(
          c.input.asOf,
          `${c.id} asOf must not exceed its fixture asOf`,
        ).toBeLessThanOrEqual(SCENARIOS[s as keyof typeof SCENARIOS].asOf)
      }
    }
  })

  it('every "incomplete" case aims at UNAVAILABLE / abstention', () => {
    const incomplete = TRADING_CORPUS.filter((c) => c.category === 'incomplete')
    expect(incomplete.length).toBeGreaterThan(0)
    for (const c of incomplete) {
      const aims =
        refusesOrAbstains(c.expectedBehavior) ||
        c.expectedBehavior.some(
          (b) =>
            (b.kind === 'field-equals' &&
              (b.path === 'conclusion.lean' || b.path === 'executionQuality')) ||
            (b.kind === 'field-in' && b.path === 'verdict'),
        )
      expect(aims, `incomplete case does not aim at UNAVAILABLE/abstain: ${c.id}`).toBe(true)
    }
  })

  it('every case carries at least one structured assertion', () => {
    for (const c of TRADING_CORPUS) {
      expect(c.expectedBehavior.length, `no assertion in ${c.id}`).toBeGreaterThan(0)
    }
  })
})
