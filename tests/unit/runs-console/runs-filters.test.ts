/**
 * AIGENT-FRONTEND-RESET-001 — the single filtering path behind /admin-v2/runs.
 *
 * These are the invariants the cockpit's truthfulness rests on: a filter must
 * narrow the real set (never fetch or fabricate), an unparseable URL value must
 * NOT silently empty the table, and the URL must round-trip the state so a
 * shared link reproduces the view it described.
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RUNS_FILTERS,
  applyRunsFilters,
  buildRunsHref,
  hasActiveFilters,
  parseRunsFilters,
  serializeRunsFilters,
  type RunsFilterState,
} from '@/lib/runs-console/runs-filters'
import { AGENT_NAMES, NOW_MS, PROJECT_NAMES, makeRun } from './runs-fixtures'

const ctx = { agentNameById: AGENT_NAMES, projectNameById: PROJECT_NAMES, nowMs: NOW_MS }

function state(patch: Partial<RunsFilterState> = {}): RunsFilterState {
  return { ...DEFAULT_RUNS_FILTERS, ...patch }
}

describe('parseRunsFilters', () => {
  it('reads every supported parameter from the URL', () => {
    const parsed = parseRunsFilters({
      q: 'btc',
      agent: 'copilot-a',
      project: 'proj-b',
      status: 'failed',
      period: '6h',
      provider: 'openai',
      model: 'gpt-5.4',
      duration: '1to10s',
      cost: 'measured',
    })

    expect(parsed).toEqual({
      q: 'btc',
      agent: 'copilot-a',
      project: 'proj-b',
      status: 'failed',
      period: '6h',
      provider: 'openai',
      model: 'gpt-5.4',
      duration: '1to10s',
      cost: 'measured',
    })
  })

  it('falls back to defaults for unknown status and period values', () => {
    const parsed = parseRunsFilters({ status: 'banana', period: '30d' })

    // The point: a hand-edited URL must show the full list, not an empty table
    // that reads as "the fleet ran nothing".
    expect(parsed.status).toBe('')
    expect(parsed.period).toBe('24h')
  })

  it('takes the first value when a parameter is repeated', () => {
    expect(parseRunsFilters({ status: ['failed', 'completed'] }).status).toBe('failed')
  })

  it('returns defaults when there are no search params at all', () => {
    expect(parseRunsFilters(undefined)).toEqual(DEFAULT_RUNS_FILTERS)
  })

  /**
   * The agent card's "Historique" tab shipped `/runs?copilot=X` while the parser
   * only ever read `agent`. Combined with the parser being unwired, that link
   * displayed a filter in the URL and rendered the WHOLE fleet. The alias is the
   * half of the fix that keeps already-shared links working.
   */
  it('accepts `copilot` as an alias of `agent`', () => {
    expect(parseRunsFilters({ copilot: 'copilot-a' }).agent).toBe('copilot-a')
  })

  it('prefers `agent` when both spellings are present', () => {
    expect(parseRunsFilters({ agent: 'copilot-a', copilot: 'copilot-b' }).agent).toBe('copilot-a')
  })

  it('normalises the alias away on the next serialization', () => {
    // A link arriving as `copilot=` leaves as `agent=`: one spelling in the URL
    // the operator ends up sharing, two accepted on the way in.
    const qs = serializeRunsFilters(parseRunsFilters({ copilot: 'copilot-a' }))
    expect(qs).toBe('agent=copilot-a')
  })
})

describe('buildRunsHref', () => {
  it('returns a bare /runs for the unfiltered view', () => {
    expect(buildRunsHref(DEFAULT_RUNS_FILTERS)).toBe('/runs')
  })

  it('composes the run selection with the active filters', () => {
    const href = buildRunsHref(state({ agent: 'copilot-a', status: 'failed' }), 'run-7')
    const params = new URLSearchParams(href.slice('/runs?'.length))

    expect(params.get('agent')).toBe('copilot-a')
    expect(params.get('status')).toBe('failed')
    expect(params.get('run')).toBe('run-7')
  })

  /**
   * The shareable-link contract, end to end: what the screen puts in the URL is
   * exactly what the server reads back out of it. A filter that survives the
   * round trip is a filter a pasted link reproduces.
   */
  it('round-trips through the parser so a pasted link reproduces the view', () => {
    const original = state({ agent: 'copilot-a', project: 'proj-b', status: 'failed', period: '1h' })
    const href = buildRunsHref(original, 'run-7')
    const params = Object.fromEntries(new URLSearchParams(href.slice('/runs?'.length)))

    expect(parseRunsFilters(params)).toEqual(original)
    // The selection rides alongside the filters without being one of them.
    expect(params.run).toBe('run-7')
  })

  it('omits an absent selection rather than writing an empty run param', () => {
    expect(buildRunsHref(state({ agent: 'copilot-a' }), null)).toBe('/runs?agent=copilot-a')
  })
})

describe('serializeRunsFilters', () => {
  it('omits defaults so a clean view has a clean URL', () => {
    expect(serializeRunsFilters(DEFAULT_RUNS_FILTERS)).toBe('')
  })

  it('round-trips a full filter state through the URL', () => {
    const original = state({ q: 'eth', agent: 'copilot-a', project: 'proj-b', status: 'failed', period: '1h' })
    const qs = serializeRunsFilters(original)
    const params = Object.fromEntries(new URLSearchParams(qs))

    expect(parseRunsFilters(params)).toEqual(original)
  })

  it('trims the query before writing it', () => {
    expect(serializeRunsFilters(state({ q: '  btc  ' }))).toBe('q=btc')
  })
})

describe('hasActiveFilters', () => {
  it('is false for the default state and true for any narrowing', () => {
    expect(hasActiveFilters(DEFAULT_RUNS_FILTERS)).toBe(false)
    expect(hasActiveFilters(state({ status: 'failed' }))).toBe(true)
    expect(hasActiveFilters(state({ period: '1h' }))).toBe(true)
    expect(hasActiveFilters(state({ q: '  ' }))).toBe(false)
  })
})

describe('applyRunsFilters', () => {
  const runs = [
    makeRun({ id: 'run-completed', status: 'completed' }),
    makeRun({ id: 'run-failed', status: 'failed' }),
    makeRun({ id: 'run-other-agent', copilotId: 'copilot-risk', projectId: 'proj-other' }),
  ]

  it('returns everything under the default state', () => {
    expect(applyRunsFilters(runs, DEFAULT_RUNS_FILTERS, ctx)).toHaveLength(3)
  })

  it('narrows by status, agent and project', () => {
    expect(applyRunsFilters(runs, state({ status: 'failed' }), ctx).map((r) => r.id)).toEqual([
      'run-failed',
    ])
    expect(applyRunsFilters(runs, state({ agent: 'copilot-risk' }), ctx).map((r) => r.id)).toEqual([
      'run-other-agent',
    ])
    expect(applyRunsFilters(runs, state({ project: 'proj-other' }), ctx).map((r) => r.id)).toEqual([
      'run-other-agent',
    ])
  })

  it('searches run id, agent name, project name and input summary', () => {
    const byId = applyRunsFilters(runs, state({ q: 'run-failed' }), ctx)
    expect(byId.map((r) => r.id)).toEqual(['run-failed'])

    const byAgentName = applyRunsFilters(runs, state({ q: 'market intelligence' }), ctx)
    expect(byAgentName).toHaveLength(2)

    const byProjectName = applyRunsFilters(runs, state({ q: 'tradeagent' }), ctx)
    expect(byProjectName).toHaveLength(2)

    const byInput = applyRunsFilters(runs, state({ q: 'BTCUSDT' }), ctx)
    expect(byInput).toHaveLength(3)
  })

  it('applies the period as a sub-window of the loaded set', () => {
    const recent = makeRun({ id: 'run-recent', startedAt: '2026-07-29T11:30:00.000Z' })
    const old = makeRun({ id: 'run-old', startedAt: '2026-07-29T02:00:00.000Z' })

    expect(applyRunsFilters([recent, old], state({ period: '1h' }), ctx).map((r) => r.id)).toEqual([
      'run-recent',
    ])
    expect(applyRunsFilters([recent, old], state({ period: '24h' }), ctx)).toHaveLength(2)
  })

  it('keeps a run whose timestamp is unparseable rather than hiding it', () => {
    const broken = makeRun({ id: 'run-broken', startedAt: 'not-a-date' })

    // Dropping it would under-report the fleet without saying so.
    expect(applyRunsFilters([broken], state({ period: '1h' }), ctx).map((r) => r.id)).toEqual([
      'run-broken',
    ])
  })

  it('combines filters conjunctively', () => {
    const result = applyRunsFilters(runs, state({ status: 'completed', agent: 'copilot-risk' }), ctx)
    expect(result.map((r) => r.id)).toEqual(['run-other-agent'])
  })

  it('never mutates the input array', () => {
    const input = [...runs]
    applyRunsFilters(input, state({ status: 'failed' }), ctx)
    expect(input).toHaveLength(3)
  })
})
