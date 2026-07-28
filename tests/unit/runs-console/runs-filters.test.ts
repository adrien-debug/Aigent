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
    })

    expect(parsed).toEqual({
      q: 'btc',
      agent: 'copilot-a',
      project: 'proj-b',
      status: 'failed',
      period: '6h',
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
