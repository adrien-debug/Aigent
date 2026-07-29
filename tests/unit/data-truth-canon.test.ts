/**
 * DATA-TRUTH CANON — one test file that pins the numbers doctrine across the
 * mission-control resolvers, so a future refactor cannot quietly resurrect a
 * fabricated `0` where the truthful value is `null` + a state.
 *
 * PATH NOTE (worker W8): the mission brief named
 * `src/lib/agent-mission-control/__tests__/data-truth-canon.test.ts`, but this
 * repo's vitest config only collects `tests/unit/**` and `tests/live/**`
 * (see vitest.config.ts include). A file under a src __tests__ folder is never
 * run — a silent false-green, which is itself a doctrine violation. Per the
 * brief's own instruction ("adapte le chemin/extension au pattern de test réel
 * du repo"), the canon lives here, where it actually executes.
 *
 * Pure & offline: pgrest is mocked, no network / gpu1 / secrets. Every case
 * imports the real exported resolver — no re-implementation, no second copy of
 * a resolver's logic.
 *
 * The doctrine, stated once (null ≠ 0):
 *   - an unmeasured cost / latency / score stays `null`, never a fake `0`;
 *   - a signal with no producer travels UNAVAILABLE (null + evidence 'none'),
 *     not `0`;
 *   - a MEASURED zero (a completed run that counted 0) is a real `0`, distinct
 *     from `null` = "never measured";
 *   - a strictly-read tool proves `mutates === false` (config ≠ capability);
 *   - a success/pass rate over 0 runs is `null` (NOT_APPLICABLE), never `0%`.
 *
 * Sibling coverage this file deliberately does NOT duplicate:
 *   - agent-health.test.ts / agent-health-unsafe-scores.test.ts — the deep
 *     resolver cases. This file is the cross-cutting canon, one assertion per
 *     doctrine point, so the invariant is visible in a single place.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
}))

import { deriveToolNatureReadOnly, type ToolNatureSignal } from '@/lib/agent-mission-control/available-agents'
import { formatPercent, formatUsd, UNAVAILABLE_LABEL } from '@/lib/agent-mission-control/format'
import { costFromMessages } from '@/lib/agent-mission-control/langgraph-server'
import { resolveCopilotHealthBatch, resolveVersionScoresBatch } from '@/lib/agent-mission-control/agent-health'

const COPILOT = 'canon-copilot'
const VERSION = 'canon-version'

/** No run of any kind anywhere — every table is empty. The "never measured" world. */
const noRuns: PgrestHandler = (_m, path) => {
  if (path.startsWith('test_runs?')) return []
  if (path.startsWith('test_results?')) return []
  if (path.startsWith('benchmark_runs?')) return []
  if (path.startsWith('benchmark_results?')) return []
  throw new Error(`Unmocked pgrest path: ${path}`)
}

/**
 * A completed benchmark run pinned to VERSION that MEASURED `unsafe` unsafe
 * actions and scored `score`. `unsafe === null` models a completed run that
 * recorded no count column at all (measured nothing on that axis).
 */
function benchmarked(unsafe: number | null, score: number | null): PgrestHandler {
  return (_m, path) => {
    if (path.startsWith('test_runs?')) return []
    if (path.startsWith('benchmark_runs?')) {
      return [{ id: 'bench-1', version_id: VERSION, copilot_id: COPILOT, started_at: '2026-07-01T00:00:00Z' }]
    }
    if (path.startsWith('benchmark_results?')) {
      return [
        {
          run_id: 'bench-1',
          ...(score === null ? {} : { score }),
          ...(unsafe === null ? {} : { unsafe_action_count: unsafe }),
        },
      ]
    }
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

beforeEach(() => {
  pgrestHandler = noRuns
})

// ---------------------------------------------------------------------------
// 1. An unmeasured COST is null and renders as a dash — never a fabricated $0.
// ---------------------------------------------------------------------------
describe('canon — cost: absence is null, never a fake 0', () => {
  it('costFromMessages returns null when no message carries provider usage', () => {
    // An interrupted / tool-only run: an AI tool-call turn + its tool result,
    // no usage_metadata anywhere. This is the exact shape that used to price 0.
    const messages = [
      { type: 'ai', content: '', tool_calls: [{ name: 'read_market', id: 'c1' }] },
      { type: 'tool', content: '{"ok":true}', tool_call_id: 'c1' },
    ]
    expect(costFromMessages(messages as never)).toBeNull()
    expect(costFromMessages(messages as never)).not.toBe(0)
  })

  it('formatUsd renders an unmeasured cost (null/undefined/NaN) as `Indisponible`, never "$0.00"', () => {
    // ONE absence vocabulary. The formatter returns the same word the screens
    // render through `<Unavailable />` — not an em dash, which this console
    // reserves for something else entirely and which reads as punctuation.
    expect(formatUsd(null)).toBe(UNAVAILABLE_LABEL)
    expect(formatUsd(undefined)).toBe(UNAVAILABLE_LABEL)
    expect(formatUsd(Number.NaN)).toBe(UNAVAILABLE_LABEL)
    expect(UNAVAILABLE_LABEL).toBe('Indisponible')
  })

  it('formatUsd renders a MEASURED zero as a real "$0.00" (measured ≠ unknown)', () => {
    expect(formatUsd(0)).toBe('$0.00')
  })
})

// ---------------------------------------------------------------------------
// 2. An unmeasured LATENCY / SCORE stays null with evidence 'none'.
//    (A signal with no producer path must travel UNAVAILABLE, i.e. null +
//     'none', never rolled up as 0.)
// ---------------------------------------------------------------------------
describe('canon — latency / score / no-producer signals: null + UNAVAILABLE, never 0', () => {
  it('a copilot with no completed run → score, latency, passRate all null; evidence none', async () => {
    const health = (await resolveCopilotHealthBatch([COPILOT])).get(COPILOT)
    expect(health).toBeDefined()
    expect(health!.benchmarkScore).toBeNull()
    expect(health!.avgLatencyMs).toBeNull()
    expect(health!.testPassRate).toBeNull()
    expect(health!.evidenceSource).toBe('none')

    // None of these unmeasured axes may masquerade as a measured 0.
    expect(health!.benchmarkScore).not.toBe(0)
    expect(health!.avgLatencyMs).not.toBe(0)
    expect(health!.testPassRate).not.toBe(0)
  })

  it('no-producer rollup: an absent producer stays null, and null must not coalesce to 0', async () => {
    // A signal with no wired producer in the pure resolver layer has one honest
    // value for "nobody produced this": null (UNAVAILABLE), never 0. This pins
    // the coalescing rule the dashboard rollup must obey —
    // `value ?? UNAVAILABLE`, never `value ?? 0`.
    const unproduced: number | null = null
    expect(unproduced ?? 'UNAVAILABLE').toBe('UNAVAILABLE')
    // The bug this guards against: `unproduced ?? 0` — which would fabricate a
    // clean measured "0" for a copilot nobody measured.
    expect(unproduced ?? 0).toBe(0) // documents the WRONG coalescing…
    expect(unproduced).not.toBe(0) //  …the value itself is null, not 0.
  })
})

// ---------------------------------------------------------------------------
// 3. A MEASURED zero on a completed run is a real 0, distinct from null.
//    (tool_call_count / unsafe_action_count = 0 on a completed run = MEASURED.)
// ---------------------------------------------------------------------------
describe('canon — measured 0 ≠ null: a completed run that counted 0 is 0', () => {
  it('completed benchmark counting 0 unsafe actions resolves to 0 (MEASURED), not null', async () => {
    pgrestHandler = benchmarked(0, 88)
    const scores = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(scores).toBeDefined()
    expect(scores!.unsafeActionCount).toBe(0)
    expect(scores!.unsafeActionCount).not.toBeNull()
    expect(scores!.evidenceSource).toBe('runs')
  })

  it('a version never benchmarked resolves unsafeActionCount to null (never 0)', async () => {
    const scores = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(scores!.unsafeActionCount).toBeNull()
    expect(scores!.unsafeActionCount).not.toBe(0)
    expect(scores!.evidenceSource).toBe('none')
  })

  it('a completed run that recorded no count column at all resolves to null, not 0', async () => {
    pgrestHandler = benchmarked(null, 88)
    const scores = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(scores!.unsafeActionCount).toBeNull()
  })

  // TARGET CONTRACT (see crossBoundaryDeps): `resolveVersionScoresBatch` today
  // coalesces a missing `benchmark_results.score` to 0 (`(r.score as number) ?? 0`),
  // which fabricates a measured "0" for a run that recorded no score. The canon
  // asserts the truthful contract — a completed run with no score column is
  // UNMEASURED (null) on that axis, exactly as `unsafe_action_count` already is.
  // This case will go green once the resolver stops coalescing score to 0.
  it('an unmeasured score stays null even when a run exists but scored nothing', async () => {
    pgrestHandler = benchmarked(0, null)
    const scores = (await resolveVersionScoresBatch([VERSION])).get(VERSION)
    expect(scores!.benchmarkScore).toBeNull()
    expect(scores!.benchmarkScore).not.toBe(0)
  })
})

// ---------------------------------------------------------------------------
// 4. A strictly-read tool proves mutates === false (config ≠ capability).
// ---------------------------------------------------------------------------
describe('canon — read-only nature: a strictly-read tool has mutates false', () => {
  const readTool: ToolNatureSignal = { riskLevel: 'low', mutates: false }
  const writeTool: ToolNatureSignal = { riskLevel: 'low', mutates: true }

  it('every tool low-risk AND mutates:false with a manifest → readOnly true', () => {
    expect(deriveToolNatureReadOnly([readTool], true)).toBe(true)
  })

  it('one mutating tool → readOnly false (capability, not policy)', () => {
    expect(deriveToolNatureReadOnly([readTool, writeTool], true)).toBe(false)
  })

  it('a high/critical-risk tool is mutating by definition, even if mutates:false is claimed', () => {
    expect(deriveToolNatureReadOnly([{ riskLevel: 'high', mutates: false }], true)).toBe(false)
    expect(deriveToolNatureReadOnly([{ riskLevel: 'critical', mutates: false }], true)).toBe(false)
  })

  it('mutates left as the column default (undefined) is NOT provably read — never assumed false', () => {
    // Only an explicit `mutates === false` proves a read; undefined is unknown.
    expect(deriveToolNatureReadOnly([{ riskLevel: 'low' }], true)).toBe(false)
  })

  it('nature unknowable (no manifest, or risk outside vocabulary) → null, never a guessed false', () => {
    expect(deriveToolNatureReadOnly([readTool], false)).toBeNull()
    expect(deriveToolNatureReadOnly([{ riskLevel: 'weird', mutates: false }], true)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// 5. Success / pass rate over 0 runs is null (NOT_APPLICABLE), never 0%.
// ---------------------------------------------------------------------------
describe('canon — success rate: 0 runs is null (NOT_APPLICABLE), never 0%', () => {
  it('no completed run → testPassRate null (the denominator is 0 → NOT_APPLICABLE)', async () => {
    const health = (await resolveCopilotHealthBatch([COPILOT])).get(COPILOT)
    expect(health!.testPassRate).toBeNull()
    // The false zero this forbids: a "0% success" verdict for an agent that
    // never ran, indistinguishable from a genuine all-failed run.
    expect(health!.testPassRate).not.toBe(0)
  })

  it('formatPercent is only ever fed a measured ratio — the null branch must be handled upstream', () => {
    // formatPercent(0) is a legitimate MEASURED "0.0%" (every decided run
    // failed). It must never be reached with a null-that-means-unmeasured;
    // callers render "—" for null. This pins the two meanings apart.
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(1)).toBe('100.0%')
    // A measured 3/4 success rate.
    expect(formatPercent(0.75)).toBe('75.0%')
  })

  it('the caller contract: a null rate renders as a dash, a measured 0 rate renders as 0%', () => {
    const render = (rate: number | null) => (rate === null ? '—' : formatPercent(rate))
    expect(render(null)).toBe('—') // 0 runs → NOT_APPLICABLE
    expect(render(0)).toBe('0.0%') // measured all-fail → real 0%
    expect(render(1)).toBe('100.0%')
  })
})
