import { describe, expect, it } from 'vitest'

import {
  buildHourlyBuckets,
  buildHourlyCost,
  buildStatusBreakdown,
  peakTotal,
} from '@/lib/cockpit/overview-series'
import type { AgentRun, AgentRunStatus } from '@/lib/agent-mission-control/types'

const NOW = Date.parse('2026-07-31T12:30:00.000Z')
const HOUR = 3_600_000

function run(overrides: Partial<AgentRun> & { startedAt: string; status: AgentRunStatus }): AgentRun {
  return {
    id: 'run-1',
    copilotId: 'cop-1',
    versionId: 'ver-1',
    projectId: 'proj-1',
    userLabel: 'operator',
    finishedAt: null,
    stepIds: [],
    inputSummary: '',
    outputSummary: '',
    toolCallCount: 0,
    unsafeAttemptCount: 0,
    latencyMs: 0,
    costUsd: null,
    ...overrides,
  } as AgentRun
}

describe('buildHourlyBuckets — la lecture échouée ne devient jamais une fenêtre calme', () => {
  it('rend null quand la fenêtre n a PAS ete lue', () => {
    expect(buildHourlyBuckets(null, NOW)).toBeNull()
  })

  it('rend une serie complete a zero quand la fenetre a ete lue et est vide', () => {
    const buckets = buildHourlyBuckets([], NOW, 24)
    expect(buckets).not.toBeNull()
    expect(buckets).toHaveLength(24)
    expect(buckets!.every((b) => b.total === 0)).toBe(true)
  })

  it('distingue les deux : null vs serie de zeros', () => {
    // C'est LE test qui protège la doctrine : les deux cas doivent différer.
    expect(buildHourlyBuckets(null, NOW)).not.toEqual(buildHourlyBuckets([], NOW))
  })
})

describe('buildHourlyBuckets — comptage', () => {
  it('range chaque run dans son heure et empile par statut', () => {
    const buckets = buildHourlyBuckets(
      [
        run({ startedAt: new Date(NOW).toISOString(), status: 'completed' }),
        run({ startedAt: new Date(NOW).toISOString(), status: 'failed' }),
        run({ startedAt: new Date(NOW - HOUR).toISOString(), status: 'completed' }),
      ],
      NOW,
      24,
    )
    const last = buckets!.at(-1)!
    const previous = buckets!.at(-2)!
    expect(last.completed).toBe(1)
    expect(last.failed).toBe(1)
    expect(last.total).toBe(2)
    expect(previous.completed).toBe(1)
    expect(previous.total).toBe(1)
  })

  it('ignore un run hors fenetre au lieu de le replier sur un bord', () => {
    const buckets = buildHourlyBuckets(
      [run({ startedAt: new Date(NOW - 40 * HOUR).toISOString(), status: 'completed' })],
      NOW,
      24,
    )
    expect(buckets!.reduce((s, b) => s + b.total, 0)).toBe(0)
  })

  it('ignore un horodatage illisible sans planter', () => {
    const buckets = buildHourlyBuckets([run({ startedAt: 'pas-une-date', status: 'completed' })], NOW, 24)
    expect(buckets!.reduce((s, b) => s + b.total, 0)).toBe(0)
  })
})

describe('buildStatusBreakdown', () => {
  it('rend null sur fenetre non lue', () => {
    expect(buildStatusBreakdown(null)).toBeNull()
  })

  it('expose les cinq statuts meme a zero quand la fenetre est lue', () => {
    const slices = buildStatusBreakdown([])
    expect(slices).toHaveLength(5)
    expect(slices!.every((s) => s.count === 0)).toBe(true)
  })

  it('compte par statut', () => {
    const slices = buildStatusBreakdown([
      run({ startedAt: new Date(NOW).toISOString(), status: 'completed' }),
      run({ startedAt: new Date(NOW).toISOString(), status: 'completed' }),
      run({ startedAt: new Date(NOW).toISOString(), status: 'blocked' }),
    ])
    expect(slices!.find((s) => s.status === 'completed')!.count).toBe(2)
    expect(slices!.find((s) => s.status === 'blocked')!.count).toBe(1)
    expect(slices!.find((s) => s.status === 'failed')!.count).toBe(0)
  })
})

describe('buildHourlyCost — un cout non mesurable n est pas un cout de zero', () => {
  it('rend null sur fenetre non lue', () => {
    expect(buildHourlyCost(null, NOW)).toBeNull()
  })

  it('compte separement les runs sans cout mesurable au lieu de les sommer comme 0', () => {
    const series = buildHourlyCost(
      [
        run({ startedAt: new Date(NOW).toISOString(), status: 'completed', costUsd: 0.25 }),
        run({ startedAt: new Date(NOW).toISOString(), status: 'completed', costUsd: null }),
      ],
      NOW,
      24,
    )
    const last = series!.at(-1)!
    expect(last.usd).toBeCloseTo(0.25)
    expect(last.measuredRuns).toBe(1)
    expect(last.unmeasuredRuns).toBe(1)
  })

  it('un cout reellement nul reste une mesure', () => {
    const series = buildHourlyCost(
      [run({ startedAt: new Date(NOW).toISOString(), status: 'completed', costUsd: 0 })],
      NOW,
      24,
    )
    const last = series!.at(-1)!
    expect(last.usd).toBe(0)
    expect(last.measuredRuns).toBe(1)
    expect(last.unmeasuredRuns).toBe(0)
  })
})

describe('peakTotal', () => {
  it('rend null sans serie — pas d echelle inventee', () => {
    expect(peakTotal(null)).toBeNull()
  })

  it('rend 0 sur une serie lue mais vide', () => {
    expect(peakTotal(buildHourlyBuckets([], NOW, 24))).toBe(0)
  })

  it('rend le pic', () => {
    const buckets = buildHourlyBuckets(
      [
        run({ startedAt: new Date(NOW).toISOString(), status: 'completed' }),
        run({ startedAt: new Date(NOW).toISOString(), status: 'failed' }),
      ],
      NOW,
      24,
    )
    expect(peakTotal(buckets)).toBe(2)
  })
})
