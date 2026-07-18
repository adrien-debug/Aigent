/**
 * Unit tests for the project team canvas status derivation
 * (src/lib/agent-mission-control/project-team/status.ts).
 *
 * Pure, offline: the module has no I/O at all — nothing to mock.
 * Covers every status, the exact priority order between them, and the
 * non-negotiable rule that missing data becomes `unavailable` and NEVER an
 * invented zero / silent `idle`.
 */
import { describe, expect, it } from 'vitest'

import {
  deriveActivity,
  deriveAgentState,
  deriveAgentStatus,
  deriveAvailability,
  pickLatestRun,
  pickLatestTerminalRun,
  toLatestRunSummary,
  type TeamRunInput,
} from '@/lib/agent-mission-control/project-team/status'

function run(over: Partial<TeamRunInput> & { id: string }): TeamRunInput {
  return {
    status: 'completed',
    startedAt: '2026-07-18T10:00:00.000Z',
    finishedAt: '2026-07-18T10:01:00.000Z',
    costUsd: 0.01,
    latencyMs: 1200,
    ...over,
  }
}

describe('deriveAvailability', () => {
  it('1 — separates draft / available / suspended / unknown', () => {
    expect(deriveAvailability('draft')).toBe('draft')
    expect(deriveAvailability('active')).toBe('available')
    expect(deriveAvailability('degraded')).toBe('available')
    expect(deriveAvailability('paused')).toBe('suspended')
    expect(deriveAvailability('archived')).toBe('suspended')
  })

  it('2 — an unrecognized or missing copilot status is unknown, never guessed', () => {
    expect(deriveAvailability('who-knows')).toBe('unknown')
    expect(deriveAvailability(null)).toBe('unknown')
    expect(deriveAvailability(undefined)).toBe('unknown')
    expect(deriveAvailability('')).toBe('unknown')
  })
})

describe('deriveAgentStatus — each status', () => {
  it('3 — draft: copilots.status is draft', () => {
    expect(deriveAgentStatus({ copilotStatus: 'draft', runs: [] })).toBe('draft')
  })

  it('4 — active: a REAL running run exists', () => {
    expect(
      deriveAgentStatus({ copilotStatus: 'active', runs: [run({ id: 'r1', status: 'running', finishedAt: null })] })
    ).toBe('active')
  })

  it('5 — waiting: a needs-confirmation run exists', () => {
    expect(
      deriveAgentStatus({
        copilotStatus: 'active',
        runs: [run({ id: 'r1', status: 'needs-confirmation', finishedAt: null })],
      })
    ).toBe('waiting')
  })

  it('6 — blocked: the latest terminal run is blocked', () => {
    expect(
      deriveAgentStatus({
        copilotStatus: 'active',
        runs: [
          run({ id: 'r1', status: 'completed', finishedAt: '2026-07-18T09:00:00.000Z' }),
          run({ id: 'r2', status: 'blocked', finishedAt: '2026-07-18T11:00:00.000Z' }),
        ],
      })
    ).toBe('blocked')
  })

  it('7 — failed: the latest terminal run is failed', () => {
    expect(
      deriveAgentStatus({
        copilotStatus: 'active',
        runs: [
          run({ id: 'r1', status: 'completed', finishedAt: '2026-07-18T09:00:00.000Z' }),
          run({ id: 'r2', status: 'failed', finishedAt: '2026-07-18T11:00:00.000Z' }),
        ],
      })
    ).toBe('failed')
  })

  it('8 — idle: available agent, zero runs (a real absence, NOT unavailable)', () => {
    expect(deriveAgentStatus({ copilotStatus: 'active', runs: [] })).toBe('idle')
  })

  it('9 — idle: latest terminal run completed', () => {
    expect(
      deriveAgentStatus({
        copilotStatus: 'active',
        runs: [run({ id: 'r1', status: 'completed' })],
      })
    ).toBe('idle')
  })

  it('10 — unavailable: runs could not be read (explicit flag)', () => {
    expect(deriveAgentStatus({ copilotStatus: 'active', runs: [], runsUnavailable: true })).toBe('unavailable')
  })

  it('11 — unavailable: incoherent copilot status', () => {
    expect(deriveAgentStatus({ copilotStatus: 'not-a-real-status', runs: [] })).toBe('unavailable')
  })
})

describe('deriveAgentStatus — priority order', () => {
  it('12 — draft beats every run-derived status', () => {
    const runs = [
      run({ id: 'r1', status: 'running', finishedAt: null }),
      run({ id: 'r2', status: 'needs-confirmation', finishedAt: null }),
      run({ id: 'r3', status: 'blocked' }),
      run({ id: 'r4', status: 'failed' }),
    ]
    expect(deriveAgentStatus({ copilotStatus: 'draft', runs })).toBe('draft')
  })

  it('13 — draft beats unavailable runs (no runtime truth needed)', () => {
    expect(deriveAgentStatus({ copilotStatus: 'draft', runs: [], runsUnavailable: true })).toBe('draft')
  })

  it('14 — active beats waiting, blocked and failed', () => {
    const runs = [
      run({ id: 'r1', status: 'blocked' }),
      run({ id: 'r2', status: 'failed' }),
      run({ id: 'r3', status: 'needs-confirmation', finishedAt: null }),
      run({ id: 'r4', status: 'running', finishedAt: null }),
    ]
    expect(deriveAgentStatus({ copilotStatus: 'active', runs })).toBe('active')
  })

  it('15 — waiting beats blocked and failed', () => {
    const runs = [
      run({ id: 'r1', status: 'blocked' }),
      run({ id: 'r2', status: 'failed' }),
      run({ id: 'r3', status: 'needs-confirmation', finishedAt: null }),
    ]
    expect(deriveAgentStatus({ copilotStatus: 'active', runs })).toBe('waiting')
  })

  it('16 — unreadable runs beat every run-derived status (no fabricated idle)', () => {
    const runs = [run({ id: 'r1', status: 'running', finishedAt: null })]
    expect(deriveAgentStatus({ copilotStatus: 'active', runs, runsUnavailable: true })).toBe('unavailable')
  })
})

describe('deriveAgentStatus — the copilots.status trap', () => {
  it('17 — NEVER derives active from copilots.status alone', () => {
    // The whole point: an "active" copilot with no running run is idle.
    expect(deriveAgentStatus({ copilotStatus: 'active', runs: [] })).toBe('idle')
    expect(
      deriveAgentStatus({ copilotStatus: 'active', runs: [run({ id: 'r1', status: 'completed' })] })
    ).toBe('idle')
  })

  it('18 — a paused/archived copilot with a running run is still reported active', () => {
    // Activity is a fact about runs; availability is reported separately.
    const runs = [run({ id: 'r1', status: 'running', finishedAt: null })]
    expect(deriveAgentStatus({ copilotStatus: 'paused', runs })).toBe('active')
    expect(deriveAvailability('paused')).toBe('suspended')
  })

  it('19 — a more recent successful run clears a previous blocked/failed state', () => {
    const runs = [
      run({ id: 'r1', status: 'blocked', finishedAt: '2026-07-18T09:00:00.000Z' }),
      run({ id: 'r2', status: 'failed', finishedAt: '2026-07-18T10:00:00.000Z' }),
      run({ id: 'r3', status: 'completed', finishedAt: '2026-07-18T11:00:00.000Z' }),
    ]
    expect(deriveAgentStatus({ copilotStatus: 'active', runs })).toBe('idle')
  })
})

describe('run selection helpers', () => {
  it('20 — pickLatestRun / pickLatestTerminalRun ignore non-terminal runs for the terminal pick', () => {
    const runs = [
      run({ id: 'r1', status: 'completed', finishedAt: '2026-07-18T09:00:00.000Z' }),
      run({ id: 'r2', status: 'running', startedAt: '2026-07-18T12:00:00.000Z', finishedAt: null }),
    ]
    expect(pickLatestRun(runs)?.id).toBe('r2')
    expect(pickLatestTerminalRun(runs)?.id).toBe('r1')
  })

  it('21 — empty list yields null, never a synthetic run', () => {
    expect(pickLatestRun([])).toBeNull()
    expect(pickLatestTerminalRun([])).toBeNull()
    expect(toLatestRunSummary(null)).toBeNull()
  })

  it('22 — ordering is deterministic on identical timestamps (id tiebreak)', () => {
    const a = [run({ id: 'aaa' }), run({ id: 'zzz' })]
    const b = [run({ id: 'zzz' }), run({ id: 'aaa' })]
    expect(pickLatestRun(a)?.id).toBe(pickLatestRun(b)?.id)
  })

  it('23 — unparseable timestamps never crash and sort oldest', () => {
    const runs = [
      run({ id: 'bad', startedAt: 'not-a-date', finishedAt: 'nope' }),
      run({ id: 'good', finishedAt: '2026-07-18T10:00:00.000Z' }),
    ]
    expect(pickLatestRun(runs)?.id).toBe('good')
  })

  it('24 — toLatestRunSummary keeps null for missing numbers instead of zeroing them', () => {
    const summary = toLatestRunSummary(
      run({ id: 'r1', costUsd: null, latencyMs: null, finishedAt: null })
    )
    expect(summary).toEqual({
      id: 'r1',
      status: 'completed',
      startedAt: '2026-07-18T10:00:00.000Z',
      completedAt: null,
      costUsd: null,
      latencyMs: null,
    })
  })
})

describe('deriveActivity / deriveAgentState', () => {
  it('25 — activity is computed purely from runs', () => {
    const activity = deriveActivity([
      run({ id: 'r1', status: 'running', finishedAt: null }),
      run({ id: 'r2', status: 'needs-confirmation', finishedAt: null }),
      run({ id: 'r3', status: 'blocked' }),
    ])
    expect(activity.hasRunning).toBe(true)
    expect(activity.hasNeedsConfirmation).toBe(true)
    expect(activity.latestTerminalRun?.id).toBe('r3')
    expect(activity.totalRuns).toBe(3)
  })

  it('26 — deriveAgentState exposes availability, activity and latestRun separately', () => {
    const state = deriveAgentState({
      copilotStatus: 'paused',
      runs: [run({ id: 'r1', status: 'completed' })],
    })
    expect(state.availability).toBe('suspended')
    expect(state.status).toBe('idle')
    expect(state.latestRun?.id).toBe('r1')
  })

  it('27 — unreadable runs expose no latestRun (never a fabricated one)', () => {
    const state = deriveAgentState({
      copilotStatus: 'active',
      runs: [run({ id: 'r1' })],
      runsUnavailable: true,
    })
    expect(state.status).toBe('unavailable')
    expect(state.latestRun).toBeNull()
  })
})
