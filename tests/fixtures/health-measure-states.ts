/**
 * ONE table of the five states `sumMeasuredHealth` can be in, read by BOTH
 * vitest projects.
 *
 * WHY IT LIVES OUTSIDE THE SUITES — the same reason as
 * `tests/fixtures/cross-screen-cost.ts`, applied one layer down. The shared rule
 * (`src/lib/agent-mission-control/health-measure.ts`) exists precisely so that
 * `/admin` (data layer, `unit` project, node + `react-server` conditions) and
 * `/admin/projects` (a React component, `components` project, happy-dom +
 * browser conditions) can no longer hold two definitions of "measured". Proving
 * that with two hand-written copies of the expected answers would re-create, in
 * the tests, the exact duplication the module removes: the two lists would drift
 * and both suites would stay green.
 *
 * So the answers are written ONCE, here, and both projects assert the SAME
 * table against the SAME function:
 *   · `tests/unit/health-measure.test.ts`        → `unit`       (node)
 *   · `tests/unit/health-measure-client.test.tsx` → `components` (happy-dom)
 * A resolve-condition-dependent difference in the rule — the class of bug that
 * would appear if the module ever picked up a conditional export or a
 * server-only dependency — makes one of the two red.
 *
 * TYPE-ONLY IMPORTS. This file must stay loadable in the browser project, so it
 * takes shapes and nothing else. `MeasuredSum` comes from the module under test,
 * which is neutral anyway; `Copilot` comes from `types.ts`, also neutral.
 */
import type { MeasuredSum } from '@/lib/agent-mission-control/health-measure'
import type { Copilot, CopilotHealthMetric } from '@/lib/agent-mission-control/types'

/**
 * A copilot with a COMPLETE health blob, so a case states only the two figures
 * it is about.
 *
 * `healthUnavailableFields` is REQUIRED here, never defaulted: `undefined` is a
 * meaningful third value in the rule (a row that never went through the data
 * layer proves nothing), and a fixture that silently supplied `[]` would make
 * every case look like it had been read.
 */
export function measureCopilot(input: {
  id: string
  runsLast24h: number
  costLast24hUsd: number
  healthUnavailableFields: CopilotHealthMetric[] | undefined
}): Copilot {
  return {
    id: input.id,
    name: input.id,
    projectId: 'p1',
    targetProjectIds: [],
    slug: input.id,
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: null,
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    healthUnavailableFields: input.healthUnavailableFields,
    health: {
      testPassRate: 1,
      benchmarkScore: 90,
      runsLast24h: input.runsLast24h,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
      costLast24hUsd: input.costLast24hUsd,
    },
  }
}

export type MeasurementCase = {
  /** Reads as the test name in both suites. */
  name: string
  team: Copilot[]
  /** What `sumMeasuredHealth(team, metric)` must return, for BOTH metrics.
   *  Every case below is built symmetric on purpose — see `expected`. */
  expected: { runs: MeasuredSum | null; cost: MeasuredSum | null }
  /** Stated separately from `expected` so a reader sees the CLAIM, and the
   *  suites can assert the claim and the shape agree with each other. */
  isAbsent: boolean
}

/**
 * THE FIVE STATES, one case each, in the order the contract states them.
 *
 * The `999`s are the load-bearing detail: a copilot named in
 * `healthUnavailableFields` still carries a NUMBER in `health` (data.ts >
 * `normalizeHealth` writes `0` there because the field is typed `number`; the
 * fixture uses `999` instead so a rollup that read past its own gate produces a
 * figure no honest sum could reach, rather than a plausible one).
 */
export const MEASUREMENT_STATES: MeasurementCase[] = [
  {
    name: 'empty team — a MEASURED zero at full coverage, not an absence',
    team: [],
    expected: {
      runs: { value: 0, measured: 0, unmeasured: 0 },
      cost: { value: 0, measured: 0, unmeasured: 0 },
    },
    isAbsent: false,
  },
  {
    name: 'measured zero — the team was read and held nothing',
    team: [
      measureCopilot({ id: 'quiet-a', runsLast24h: 0, costLast24hUsd: 0, healthUnavailableFields: [] }),
      measureCopilot({ id: 'quiet-b', runsLast24h: 0, costLast24hUsd: 0, healthUnavailableFields: [] }),
    ],
    expected: {
      runs: { value: 0, measured: 2, unmeasured: 0 },
      cost: { value: 0, measured: 2, unmeasured: 0 },
    },
    isAbsent: false,
  },
  {
    name: 'measured positive at FULL coverage — the exact total',
    team: [
      measureCopilot({ id: 'busy-a', runsLast24h: 3, costLast24hUsd: 12.5, healthUnavailableFields: [] }),
      measureCopilot({ id: 'busy-b', runsLast24h: 4, costLast24hUsd: 0.5, healthUnavailableFields: [] }),
    ],
    expected: {
      runs: { value: 7, measured: 2, unmeasured: 0 },
      cost: { value: 13, measured: 2, unmeasured: 0 },
    },
    isAbsent: false,
  },
  {
    name: 'PARTIAL coverage — the proven sum, with the gap disclosed',
    team: [
      measureCopilot({ id: 'proven', runsLast24h: 2, costLast24hUsd: 0.25, healthUnavailableFields: [] }),
      measureCopilot({
        id: 'blind-1',
        runsLast24h: 999,
        costLast24hUsd: 999,
        healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
      }),
      measureCopilot({
        id: 'blind-2',
        runsLast24h: 999,
        costLast24hUsd: 999,
        healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
      }),
    ],
    expected: {
      runs: { value: 2, measured: 1, unmeasured: 2 },
      cost: { value: 0.25, measured: 1, unmeasured: 2 },
    },
    isAbsent: false,
  },
  {
    name: 'ABSENT measurement — a team that exists and proved nothing',
    team: [
      measureCopilot({
        id: 'dark-a',
        runsLast24h: 999,
        costLast24hUsd: 999,
        healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
      }),
      // Never read at all: `healthUnavailableFields` undefined. A DIFFERENT
      // reason for the same verdict, in the same case, so the state cannot be
      // satisfied by handling only one of the two.
      measureCopilot({
        id: 'dark-b',
        runsLast24h: 999,
        costLast24hUsd: 999,
        healthUnavailableFields: undefined,
      }),
    ],
    expected: { runs: null, cost: null },
    isAbsent: true,
  },
]

/** The metric key each half of `expected` belongs to — so a suite iterates the
 *  two metrics instead of writing the pair out twice. */
export const MEASURED_METRICS: { metric: CopilotHealthMetric; key: 'runs' | 'cost' }[] = [
  { metric: 'runsLast24h', key: 'runs' },
  { metric: 'costLast24hUsd', key: 'cost' },
]
