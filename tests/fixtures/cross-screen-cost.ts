/**
 * ONE fixture, read by BOTH test projects, so `/admin` and `/admin/projects`
 * are compared against the same three projects rather than against two
 * hand-written descriptions of them.
 *
 * WHY IT LIVES OUTSIDE THE SUITES. The two screens are covered by two vitest
 * projects with different resolve conditions:
 *   · `tests/unit/dashboard-overview.test.ts`   → `unit` (node, react-server) —
 *     the only one that may import `dashboard-overview.ts`, which opens with
 *     `import 'server-only'`.
 *   · `tests/unit/overview-screen-truth.test.tsx` → `components` (happy-dom,
 *     browser conditions) — where that same VALUE import throws at load time.
 * So the component suite cannot call `buildProjectOverview` to find out what a
 * team rolls up to; it has to be TOLD. Duplicating the answer in both files is
 * how two descriptions of one fact drift apart — which is the precise defect
 * this branch exists to close, so it is not the mechanism used to test it.
 *
 * THE CONTRACT BETWEEN THE TWO HALVES:
 *   · `CROSS_SCREEN_TEAM` + `CROSS_SCREEN_PROJECTS` are what `/admin/projects`
 *     receives (`ProjectsScreen projects copilots`).
 *   · `CROSS_SCREEN_ITEMS` is what `/admin` receives for the same three
 *     projects (`DashboardOverview.projects`).
 *   · `dashboard-overview.test.ts` › C13 asserts, whole-object and in order,
 *     that `buildProjectOverview(CROSS_SCREEN_PROJECTS, CROSS_SCREEN_TEAM)`
 *     equals `CROSS_SCREEN_ITEMS`. That single assertion is what makes the
 *     component suite's rendering evidence about the real data layer.
 *
 * ONE PROJECT PER STATE OF THE CONTRACT — the three that must never collapse
 * into each other:
 *   · `p-proven` — measured, non-zero: `3` runs, `$12.50`.
 *   · `p-zero`   — measured AT ZERO: `0` runs, `$0.00`. A fact, and it renders
 *                  as a real formatted zero on both screens.
 *   · `p-dark`   — NOT MEASURABLE: the team exists and proved neither metric.
 *                  Renders the word `Indisponible` on both screens, never `0`
 *                  and never `$0.00`.
 *
 * Type-only imports throughout, so this module is safe in the browser project:
 * `ProjectOverviewItem` comes from the `server-only` file, and taking the TYPE
 * costs nothing at runtime.
 */
import type { ProjectOverviewItem } from '@/lib/agent-mission-control/dashboard-overview'
import type { Copilot, Project } from '@/lib/agent-mission-control/types'

/** A copilot with every health field present, so a fixture states only the two
 *  it is about and never ships a partial blob. */
function copilot(input: {
  id: string
  name: string
  projectId: string
  runsLast24h: number
  costLast24hUsd: number
  healthUnavailableFields: Copilot['healthUnavailableFields']
}): Copilot {
  return {
    id: input.id,
    name: input.name,
    projectId: input.projectId,
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

function project(id: string, name: string): Project {
  return {
    id,
    name,
    slug: id,
    description: '',
    platform: 'web',
    createdAt: '2026-01-01T00:00:00Z',
  }
}

export const CROSS_SCREEN_PROJECTS: Project[] = [
  project('p-proven', 'Proven'),
  project('p-zero', 'Zero'),
  project('p-dark', 'Dark'),
]

export const CROSS_SCREEN_TEAM: Copilot[] = [
  copilot({
    id: 'c-proven',
    name: 'Proven',
    projectId: 'p-proven',
    healthUnavailableFields: [],
    runsLast24h: 3,
    costLast24hUsd: 12.5,
  }),
  copilot({
    id: 'c-zero',
    name: 'Zero',
    projectId: 'p-zero',
    healthUnavailableFields: [],
    runsLast24h: 0,
    costLast24hUsd: 0,
  }),
  copilot({
    id: 'c-dark',
    name: 'Dark',
    projectId: 'p-dark',
    // The 99s are normalisation placeholders (data.ts › normalizeHealth), not
    // measurements — `healthUnavailableFields` is what says so. A rollup that
    // ever surfaced 99 would be reading the blob past its own gate.
    healthUnavailableFields: ['runsLast24h', 'costLast24hUsd'],
    runsLast24h: 99,
    costLast24hUsd: 99,
  }),
]

/**
 * What `buildProjectOverview` derives from the two above — pinned whole, and in
 * this order, by `dashboard-overview.test.ts` › C13.
 *
 * `passRate` is `1` on all three INCLUDING `p-dark`: its unavailable list names
 * `runsLast24h` and `costLast24hUsd` and not `testPassRate`, so that metric
 * stays a measurement. The three fields are gated one by one, and the fixture
 * would hide it if it pretended otherwise.
 */
export const CROSS_SCREEN_ITEMS: ProjectOverviewItem[] = [
  {
    id: 'p-proven',
    name: 'Proven',
    imageUrl: null,
    logoUrl: null,
    repoFullName: null,
    platform: 'web',
    copilotCount: 1,
    activeCount: 1,
    runsLast24h: 3,
    costLast24hUsd: 12.5,
    passRate: 1,
  },
  {
    id: 'p-zero',
    name: 'Zero',
    imageUrl: null,
    logoUrl: null,
    repoFullName: null,
    platform: 'web',
    copilotCount: 1,
    activeCount: 1,
    runsLast24h: 0,
    costLast24hUsd: 0,
    passRate: 1,
  },
  {
    id: 'p-dark',
    name: 'Dark',
    imageUrl: null,
    logoUrl: null,
    repoFullName: null,
    platform: 'web',
    copilotCount: 1,
    activeCount: 1,
    runsLast24h: null,
    costLast24hUsd: null,
    passRate: 1,
  },
]
