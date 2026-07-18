/**
 * Unit tests for getProjectTeamGraph
 * (src/lib/agent-mission-control/project-team/data.ts).
 *
 * Pure, offline: `pgrest` and the `data` read layer are mocked at module level
 * (vi.mock is hoisted) exactly like tests/unit/runtime-telemetry-endpoint.test.ts
 * — no network, no gpu1 backend, no secrets.
 *
 * Focus: strict project isolation, the no-fabrication rule on unreadable data,
 * and the outgoing contract holding under zod.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string, body?: unknown) => unknown

let pgrestHandler: PgrestHandler = () => []
let copilotsHandler: () => unknown = () => []
let projectHandler: (id: string) => unknown = () => undefined
/**
 * Forces PostgREST's exact `count=exact` total to differ from the rows handed
 * back — i.e. simulates a run set LARGER than the fetch window. `null` means
 * "count the rows we returned", the honest non-truncated case.
 */
let runsCountOverride: number | null = null

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => pgrestHandler(method, path, body)),
  pgrestWithCount: vi.fn(async (path: string) => {
    const rows = pgrestHandler('GET', path) as Record<string, unknown>[]
    const isRuns = path.split('?')[0] === 'agent_runs'
    return { rows, count: isRuns && runsCountOverride !== null ? runsCountOverride : rows.length }
  }),
  isPgrestTimeout: () => false,
  pgrestDetail: (err: unknown) => (err instanceof Error ? err.message : String(err)),
  camelRows: <T,>(rows: Record<string, unknown>[]): T[] =>
    rows.map((row) => {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(row)) {
        out[k.replace(/_([a-z0-9])/g, (_m, c: string) => c.toUpperCase())] = v
      }
      return out as T
    }),
}))

// getCopilots() is deliberately NOT mocked any more: the graph no longer reads
// the whole copilots table through it (it would also drag in the 5-round-trip
// health batch). Agents now come from a project-scoped `copilots` read, routed
// through the pgrest mock like every other table.
vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async (id: string) => projectHandler(id)),
}))

import { getProjectTeamGraph } from '@/lib/agent-mission-control/project-team/data'
import { projectNodeId } from '@/lib/agent-mission-control/project-team/relations'
import { parseProjectTeamGraph } from '@/lib/agent-mission-control/project-team/schema'

const PROJECT = 'proj-test'
const NOW = new Date('2026-07-18T12:00:00.000Z')

interface FakeCopilot {
  id: string
  projectId: string | null
  name: string
  slug?: string
  description?: string
  runtime?: string
  status?: string
  model?: string
  tags?: string[]
}

function copilot(over: Partial<FakeCopilot> & { id: string }): Record<string, unknown> {
  return {
    projectId: PROJECT,
    name: over.id,
    slug: over.id,
    description: '',
    runtime: 'langgraph',
    status: 'active',
    model: 'gpt-4o',
    modelProvider: 'openai',
    tags: [],
    targetProjectIds: [],
    health: {},
    ...over,
  }
}

/** Raw agent_runs row shape (snake_case, as PostgREST returns it). */
function runRow(over: Record<string, unknown> & { id: string; copilot_id: string }): Record<string, unknown> {
  return {
    status: 'completed',
    started_at: '2026-07-18T10:00:00.000Z',
    finished_at: '2026-07-18T10:05:00.000Z',
    cost_usd: 0.02,
    latency_ms: 900,
    ...over,
  }
}

/** Route the mocked pgrest by table name. `copilots` always comes from copilotsHandler. */
function routeTables(tables: {
  agent_runs?: Record<string, unknown>[] | (() => never)
  tools?: Record<string, unknown>[] | (() => never)
  project_agent_relations?: Record<string, unknown>[] | (() => never)
  mission_runs?: Record<string, unknown>[] | (() => never)
}): PgrestHandler {
  return (_method, path) => {
    const table = path.split('?')[0] ?? ''
    if (table === 'copilots') return copilotsHandler()
    const value = tables[table as keyof typeof tables]
    if (typeof value === 'function') return value()
    return value ?? []
  }
}

describe('getProjectTeamGraph', () => {
  beforeEach(() => {
    projectHandler = (id) => (id === PROJECT ? { id: PROJECT, name: 'Test Project', slug: 'test', description: 'd' } : undefined)
    copilotsHandler = () => []
    pgrestHandler = routeTables({})
    runsCountOverride = null
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1 — returns undefined for a project that does not exist (404 signal)', async () => {
    expect(await getProjectTeamGraph('nope', { now: NOW })).toBeUndefined()
  })

  it('2 — a project with zero agents yields a valid graph with real zeros', async () => {
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph).toBeDefined()
    expect(graph?.summary.totalAgents).toBe(0)
    expect(graph?.nodes).toHaveLength(1)
    expect(graph?.nodes[0]?.kind).toBe('project')
    expect(graph?.edges).toEqual([])
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('3 — STRICT ISOLATION: agents of another project and NULL-project agents never appear', async () => {
    copilotsHandler = () => [
      copilot({ id: 'mine' }),
      copilot({ id: 'other', projectId: 'proj-other' }),
      copilot({ id: 'orphan', projectId: null }),
      // targetProjectIds is development intent, NOT membership.
      copilot({ id: 'targeting', projectId: 'proj-other', targetProjectIds: [PROJECT] } as Partial<FakeCopilot> & { id: string }),
    ]
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const agentIds = graph?.nodes.filter((n) => n.kind === 'agent').map((n) => n.id)
    expect(agentIds).toEqual(['mine'])
    expect(graph?.summary.totalAgents).toBe(1)
  })

  it('4 — a single agent gets a node, a membership edge and an /admin/agents href', async () => {
    copilotsHandler = () => [copilot({ id: 'a', name: 'Atlas' })]
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.name).toBe('Atlas')
    expect(node?.href).toBe('/admin/agents/a')
    expect(graph?.edges).toHaveLength(1)
    expect(graph?.edges[0]).toMatchObject({
      source: 'a',
      target: projectNodeId(PROJECT),
      relation: 'project-membership',
    })
  })

  it('5 — statuses are derived from RUNS, not from copilots.status', async () => {
    copilotsHandler = () => [
      copilot({ id: 'running' }),
      copilot({ id: 'confirming' }),
      copilot({ id: 'stopped' }),
      copilot({ id: 'broken' }),
      copilot({ id: 'quiet' }),
      copilot({ id: 'unbuilt', status: 'draft' }),
    ]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'running', status: 'running', finished_at: null }),
        runRow({ id: 'r2', copilot_id: 'confirming', status: 'needs-confirmation', finished_at: null }),
        runRow({ id: 'r3', copilot_id: 'stopped', status: 'blocked' }),
        runRow({ id: 'r4', copilot_id: 'broken', status: 'failed' }),
        runRow({ id: 'r5', copilot_id: 'quiet', status: 'completed' }),
      ],
    })

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const status = (id: string) => graph?.nodes.find((n) => n.id === id)?.status
    expect(status('running')).toBe('active')
    expect(status('confirming')).toBe('waiting')
    expect(status('stopped')).toBe('blocked')
    expect(status('broken')).toBe('failed')
    // `copilots.status === 'active'` + a completed run => idle, never active.
    expect(status('quiet')).toBe('idle')
    expect(status('unbuilt')).toBe('draft')

    expect(graph?.summary).toMatchObject({
      totalAgents: 6,
      activeAgents: 1,
      waitingAgents: 1,
      blockedAgents: 1,
      failedAgents: 1,
      draftAgents: 1,
    })
  })

  it('6 — NO FABRICATION: unreadable runs mark nodes unavailable instead of zeroing them', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.status).toBe('unavailable')
    expect(node?.latestRun).toBeNull()
    // EVERY count is null, not 0. An unread run set is not "0 runs", it is
    // "unknown" — this is the exact fabricated-zero the contract exists to stop.
    expect(node?.metrics.totalRuns).toBeNull()
    expect(node?.metrics.runsToday).toBeNull()
    // successRate stays null — an unread run set is NOT a 0% success rate.
    expect(node?.metrics.successRate).toBeNull()
    // Same rule at project level: no fabricated project totals either.
    const projectNode = graph?.nodes.find((n) => n.kind === 'project')
    expect(projectNode?.metrics.totalRuns).toBeNull()
    expect(projectNode?.metrics.runsToday).toBeNull()
    expect(graph?.summary.runsToday).toBeNull()
    expect(graph?.freshness.latestActivityAt).toBeNull()
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()

    errorSpy.mockRestore()
  })

  it('6b — a REAL zero and an UNKNOWN are different values, not just different labels', async () => {
    // The defect this pins: both used to serialize as `0`, so no consumer could
    // tell "this agent has never run" from "we could not read the runs".
    copilotsHandler = () => [copilot({ id: 'a' })]
    const measured = await getProjectTeamGraph(PROJECT, { now: NOW })
    const measuredMetrics = measured?.nodes.find((n) => n.kind === 'agent')?.metrics

    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unknown = await getProjectTeamGraph(PROJECT, { now: NOW })
    const unknownMetrics = unknown?.nodes.find((n) => n.kind === 'agent')?.metrics
    errorSpy.mockRestore()

    expect(measuredMetrics?.totalRuns).toBe(0)
    expect(unknownMetrics?.totalRuns).toBeNull()
    expect(measuredMetrics).not.toEqual(unknownMetrics)
  })

  it('7 — an agent with zero runs is idle with a null successRate (never a fabricated 0)', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.status).toBe('idle')
    expect(node?.metrics).toEqual({ totalRuns: 0, runsToday: 0, successRate: null })
  })

  it('8 — metrics and runsToday are computed on the current UTC day', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T01:00:00.000Z' }),
        runRow({ id: 'r2', copilot_id: 'a', started_at: '2026-07-18T23:00:00.000Z' }),
        runRow({ id: 'r3', copilot_id: 'a', started_at: '2026-07-17T23:00:00.000Z' }),
        runRow({ id: 'r4', copilot_id: 'a', started_at: '2026-07-17T10:00:00.000Z', status: 'failed' }),
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.metrics.totalRuns).toBe(4)
    expect(node?.metrics.runsToday).toBe(2)
    expect(node?.metrics.successRate).toBe(0.75)
    expect(graph?.summary.runsToday).toBe(2)
  })

  it('9 — freshness reports LIVE and the most recent run start', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T01:00:00.000Z' }),
        runRow({ id: 'r2', copilot_id: 'a', started_at: '2026-07-18T09:30:00.000Z' }),
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.freshness.source).toBe('LIVE')
    expect(graph?.freshness.latestActivityAt).toBe('2026-07-18T09:30:00.000Z')
  })

  it('10 — tools are batched into a single in.() query, never one per agent', async () => {
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' }), copilot({ id: 'c' })]
    const toolQueries: string[] = []
    pgrestHandler = (_method, path) => {
      const table = path.split('?')[0]
      if (table === 'copilots') return copilotsHandler()
      if (table === 'tools') {
        toolQueries.push(path)
        return [
          { id: 't1', name: 'draft_copilot_spec', copilot_id: 'a' },
          { id: 't2', name: 'draft_copilot_spec', copilot_id: 'b' },
        ]
      }
      return []
    }

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(toolQueries).toHaveLength(1)
    expect(toolQueries[0]).toContain('copilot_id=in.(a,b,c)')
    expect(graph?.nodes.find((n) => n.id === 'a')?.tools).toEqual([
      { id: 't1', name: 'draft_copilot_spec' },
    ])
    // And the shared name yields a derived edge.
    expect(graph?.edges.some((e) => e.relation === 'shares-tool' && e.origin === 'derived')).toBe(true)
  })

  it('11 — explicit relations are loaded and marked origin explicit', async () => {
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      project_agent_relations: [
        {
          id: 'rel1',
          project_id: PROJECT,
          source_copilot_id: 'a',
          target_copilot_id: 'b',
          relation_type: 'sends-output-to',
          label: 'invoice batch',
          is_active: true,
        },
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const edge = graph?.edges.find((e) => e.relation === 'sends-output-to')
    expect(edge).toMatchObject({ source: 'a', target: 'b', origin: 'explicit', label: 'invoice batch' })
  })

  it('12 — a relation pointing at a deleted agent produces no dangling edge', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      project_agent_relations: [
        {
          id: 'rel1',
          project_id: PROJECT,
          source_copilot_id: 'a',
          target_copilot_id: 'deleted',
          relation_type: 'depends-on',
          is_active: true,
        },
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const nodeIds = new Set(graph?.nodes.map((n) => n.id))
    for (const edge of graph?.edges ?? []) {
      expect(nodeIds.has(edge.source)).toBe(true)
      expect(nodeIds.has(edge.target)).toBe(true)
    }
    expect(graph?.edges.some((e) => e.relation === 'depends-on')).toBe(false)
  })

  it('13 — a missing project_agent_relations table degrades to zero relations, not a crash', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      project_agent_relations: () => {
        throw new Error('PostgREST 404 PGRST205 relation does not exist')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.nodes.find((n) => n.kind === 'agent')?.status).toBe('idle')
    expect(graph?.edges).toHaveLength(1)

    errorSpy.mockRestore()
  })

  it('14 — team grouping produces a group node and team-membership edges', async () => {
    copilotsHandler = () => [
      copilot({ id: 'a', tags: ['review', 'drafted'] }),
      copilot({ id: 'b', tags: ['review'] }),
      copilot({ id: 'c', tags: ['drafted'] }),
    ]
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const groupNode = graph?.nodes.find((n) => n.kind === 'group')
    expect(groupNode?.name).toBe('Review')
    expect(graph?.edges.filter((e) => e.relation === 'team-membership').map((e) => e.source).sort()).toEqual([
      'a',
      'b',
    ])
    // The provenance-only agent hangs off the project directly.
    expect(graph?.nodes.find((n) => n.id === 'c')?.team).toBeNull()

    // V1 END-TO-END: tag-derived grouping must reach the UI as `derived`, so it
    // renders dashed and reads "Derived" instead of claiming to be configured.
    const teamEdges = graph?.edges.filter((e) => e.relation === 'team-membership') ?? []
    expect(teamEdges.every((e) => e.origin === 'derived')).toBe(true)
    const groupEdge = graph?.edges.find(
      (e) => e.relation === 'project-membership' && e.source === groupNode?.id
    )
    expect(groupEdge?.origin).toBe('derived')
    // The ungrouped agent's own edge IS explicit: it restates copilots.project_id.
    const directEdge = graph?.edges.find(
      (e) => e.relation === 'project-membership' && e.source === 'c'
    )
    expect(directEdge?.origin).toBe('explicit')
  })

  it('14a — no edge reaching the UI claims activity without a persisted relation event', async () => {
    // Two agents both running recently (co-activity) and sharing a tool. The
    // canvas animates flow on `active`, so nothing here may set it.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'a', status: 'completed' }),
        runRow({ id: 'r2', copilot_id: 'b', status: 'completed' }),
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.edges.length).toBeGreaterThan(0)
    expect(graph?.edges.every((e) => e.active === false)).toBe(true)
    expect(graph?.edges.every((e) => e.lastActivityAt === null)).toBe(true)
  })

  it('15 — a 25-agent project stays coherent and contract-valid', async () => {
    const agents = Array.from({ length: 25 }, (_, i) => copilot({ id: `a${String(i).padStart(2, '0')}` }))
    copilotsHandler = () => agents
    pgrestHandler = routeTables({
      agent_runs: agents.map((a, i) =>
        runRow({ id: `r${i}`, copilot_id: a.id as string, status: i % 5 === 0 ? 'failed' : 'completed' })
      ),
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.summary.totalAgents).toBe(25)
    expect(graph?.summary.failedAgents).toBe(5)
    expect(graph?.nodes.filter((n) => n.kind === 'agent')).toHaveLength(25)
    expect(graph?.edges).toHaveLength(25)
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('16 — a relation cycle survives intact', async () => {
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' }), copilot({ id: 'c' })]
    pgrestHandler = routeTables({
      project_agent_relations: [
        { id: 'r1', project_id: PROJECT, source_copilot_id: 'a', target_copilot_id: 'b', relation_type: 'triggers', is_active: true },
        { id: 'r2', project_id: PROJECT, source_copilot_id: 'b', target_copilot_id: 'c', relation_type: 'triggers', is_active: true },
        { id: 'r3', project_id: PROJECT, source_copilot_id: 'c', target_copilot_id: 'a', relation_type: 'triggers', is_active: true },
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.edges.filter((e) => e.relation === 'triggers')).toHaveLength(3)
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('17 — the graph NEVER carries a manifest/prompt field, and manifests is never queried', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    const queriedTables: string[] = []
    pgrestHandler = (_method, path) => {
      const table = path.split('?')[0] as string
      queriedTables.push(table)
      if (table === 'copilots') return copilotsHandler()
      return []
    }
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })

    expect(queriedTables).not.toContain('manifests')
    const serialized = JSON.stringify(graph)
    expect(serialized).not.toContain('systemPromptSummary')
    expect(serialized).not.toContain('system_prompt_summary')
    // `.strict()` on the schema is what keeps this true if the shape ever drifts.
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('19 — TRUNCATION: a windowed run set never reports its floor as a total', async () => {
    // 2 rows in the window, but PostgREST's exact count says 4210 runs exist.
    // The old code reported `rows.length` as "Total runs" — a silently wrong
    // number labelled as complete.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' }),
        runRow({ id: 'r2', copilot_id: 'a', started_at: '2026-07-18T08:00:00.000Z' }),
      ],
    })
    runsCountOverride = 4210

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })

    // Project total is EXACT — straight from count=exact, not from the window.
    const projectNode = graph?.nodes.find((n) => n.kind === 'project')
    expect(projectNode?.metrics.totalRuns).toBe(4210)

    // The agent visible in the window has a real recent history, but its
    // lifetime count is only a floor => unknown, never the floor itself.
    const a = graph?.nodes.find((n) => n.id === 'a')
    expect(a?.metrics.totalRuns).toBeNull()
    expect(a?.metrics.runsToday).toBeNull()
    expect(a?.metrics.successRate).toBeNull()
    // Its latest run IS knowable: the window is globally newest-first.
    expect(a?.latestRun?.id).toBe('r1')

    // Agent 'b' is absent from the window. Under truncation that is ambiguous
    // (never ran? or pushed out by a busier agent?) => unavailable, not `idle`.
    const b = graph?.nodes.find((n) => n.id === 'b')
    expect(b?.status).toBe('unavailable')
    expect(b?.metrics.totalRuns).toBeNull()

    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('20 — an exhausted window is exact: counts stay real numbers, nothing degrades', async () => {
    // The common case must NOT be collateral damage of the truncation fix.
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' })],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.status).toBe('idle')
    expect(node?.metrics).toEqual({ totalRuns: 1, runsToday: 1, successRate: 1 })
    expect(graph?.summary.runsToday).toBe(1)
  })

  it('21 — a group total is unknown when ANY member is unknown (never a silent undercount)', async () => {
    copilotsHandler = () => [
      copilot({ id: 'a', tags: ['review'] }),
      copilot({ id: 'b', tags: ['review'] }),
    ]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' })],
    })
    runsCountOverride = 900 // truncated => 'b' is unknown, 'a' is a floor

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const group = graph?.nodes.find((n) => n.kind === 'group')
    expect(group?.metrics.totalRuns).toBeNull()
    expect(group?.metrics.runsToday).toBeNull()
  })

  it('22 — agents are read SCOPED to the project, not by scanning the whole estate', async () => {
    // The old path read `copilots?select=*` (every copilot in the DB) and then
    // ran a 5-round-trip health batch over ALL of them — on a ~10s poll, per
    // open tab, to draw one project.
    copilotsHandler = () => [copilot({ id: 'a' })]
    const paths: string[] = []
    pgrestHandler = (_method, path) => {
      paths.push(path)
      if (path.split('?')[0] === 'copilots') return copilotsHandler()
      return []
    }

    await getProjectTeamGraph(PROJECT, { now: NOW })

    const copilotQueries = paths.filter((p) => p.startsWith('copilots?'))
    expect(copilotQueries).toHaveLength(1)
    expect(copilotQueries[0]).toContain(`project_id=eq.${PROJECT}`)
    // Narrow select — no `select=*`, no health/manifest/assistant columns.
    expect(copilotQueries[0]).not.toContain('select=*')

    // The health batch is gone: none of its tables is touched at all.
    for (const table of ['test_runs', 'test_results', 'benchmark_runs', 'benchmark_results']) {
      expect(paths.some((p) => p.startsWith(`${table}?`))).toBe(false)
    }
  })

  it('23 — the relations read is narrow: operator-writable metadata is never pulled', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    const paths: string[] = []
    pgrestHandler = (_method, path) => {
      paths.push(path)
      if (path.split('?')[0] === 'copilots') return copilotsHandler()
      return []
    }
    await getProjectTeamGraph(PROJECT, { now: NOW })

    const relationQuery = paths.find((p) => p.startsWith('project_agent_relations?'))
    expect(relationQuery).toBeDefined()
    expect(relationQuery).not.toContain('select=*')
    expect(relationQuery).not.toContain('metadata')
    expect(relationQuery).toContain('relation_type')
  })

  // ---------------------------------------------------------------------------
  // Defect 1b — the summary counters must not fabricate zeros
  // ---------------------------------------------------------------------------

  it('24 — unreadable runs make the four activity counters UNKNOWN, never "0 active"', async () => {
    // The exact defect: every agent turns `unavailable`, so countBy() returned 0
    // four times and the UI asserted "0 Active · 0 Waiting · 0 Blocked · 0
    // Failed" — read aloud by the aria-live region — when nothing was known.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    errorSpy.mockRestore()

    expect(graph?.summary.activeAgents).toBeNull()
    expect(graph?.summary.waitingAgents).toBeNull()
    expect(graph?.summary.blockedAgents).toBeNull()
    expect(graph?.summary.failedAgents).toBeNull()
    // Not silently vanished: the agents are counted where they actually are.
    expect(graph?.summary.unavailableAgents).toBe(2)
    // Still facts — these never depended on the runs read.
    expect(graph?.summary.totalAgents).toBe(2)
    expect(graph?.summary.draftAgents).toBe(0)
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('25 — a PARTIALLY unknown roster yields unknown counters, not a floor', async () => {
    // 'a' is visible and idle, 'b' was pushed out of the truncated window. "0
    // active" would be a floor presented as a total: 'b' might be running.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' })],
    })
    runsCountOverride = 900

    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.nodes.find((n) => n.id === 'b')?.status).toBe('unavailable')
    expect(graph?.summary.activeAgents).toBeNull()
    expect(graph?.summary.failedAgents).toBeNull()
    expect(graph?.summary.unavailableAgents).toBe(1)
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('26 — a MEASURED zero survives: known statuses still publish real counts', async () => {
    // The fix must not turn every count into null. With the whole roster
    // readable, "0 failed" is a fact and must stay the number 0.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: [
        runRow({ id: 'r1', copilot_id: 'a', status: 'running', finished_at: null }),
        runRow({ id: 'r2', copilot_id: 'b', status: 'completed' }),
      ],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.summary.activeAgents).toBe(1)
    expect(graph?.summary.failedAgents).toBe(0)
    expect(graph?.summary.blockedAgents).toBe(0)
    expect(graph?.summary.unavailableAgents).toBe(0)
  })

  it('26b — a fabricated 0 and an unknown are different VALUES on the summary', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', status: 'completed' })],
    })
    const measured = await getProjectTeamGraph(PROJECT, { now: NOW })

    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unknown = await getProjectTeamGraph(PROJECT, { now: NOW })
    errorSpy.mockRestore()

    expect(measured?.summary.activeAgents).toBe(0)
    expect(unknown?.summary.activeAgents).toBeNull()
    expect(measured?.summary).not.toEqual(unknown?.summary)
  })

  // ---------------------------------------------------------------------------
  // Defect 1c — a null latestRun is not automatically "never ran"
  // ---------------------------------------------------------------------------

  it('27 — the THREE reasons for a null latestRun stay distinguishable', async () => {
    // (a) genuinely never ran — the runs WERE read, and there were none.
    copilotsHandler = () => [copilot({ id: 'a' })]
    const neverRan = await getProjectTeamGraph(PROJECT, { now: NOW })
    const neverRanNode = neverRan?.nodes.find((n) => n.kind === 'agent')
    expect(neverRanNode?.latestRun).toBeNull()
    expect(neverRanNode?.runHistory).toBe('known')

    // (b) runs unreadable — nothing may be claimed about activity.
    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unreadable = await getProjectTeamGraph(PROJECT, { now: NOW })
    errorSpy.mockRestore()
    const unreadableNode = unreadable?.nodes.find((n) => n.kind === 'agent')
    expect(unreadableNode?.latestRun).toBeNull()
    expect(unreadableNode?.runHistory).toBe('unreadable')

    // (c) outside the read window — busier agents pushed it out.
    copilotsHandler = () => [copilot({ id: 'a' }), copilot({ id: 'b' })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' })],
    })
    runsCountOverride = 900
    const truncated = await getProjectTeamGraph(PROJECT, { now: NOW })
    const pushedOut = truncated?.nodes.find((n) => n.id === 'b')
    expect(pushedOut?.latestRun).toBeNull()
    expect(pushedOut?.runHistory).toBe('outside-window')

    // All three carry the SAME null latestRun — the state is the only thing
    // that tells them apart, which is exactly why the renderer needs it.
    expect(new Set([neverRanNode, unreadableNode, pushedOut].map((n) => n?.runHistory)).size).toBe(3)

    // An agent that DID run inside the window reports a real run, state `known`.
    expect(truncated?.nodes.find((n) => n.id === 'a')?.runHistory).toBe('known')
    expect(truncated?.nodes.find((n) => n.id === 'a')?.latestRun?.id).toBe('r1')
  })

  it('27b — container nodes report `not-applicable`, never "no run recorded"', async () => {
    copilotsHandler = () => [copilot({ id: 'a', tags: ['review'] }), copilot({ id: 'b', tags: ['review'] })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:00:00.000Z' })],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    // The project hub HAS runs beneath it; claiming it "never ran" would be false.
    expect(graph?.nodes.find((n) => n.kind === 'project')?.runHistory).toBe('not-applicable')
    expect(graph?.nodes.find((n) => n.kind === 'group')?.runHistory).toBe('not-applicable')
  })

  // ---------------------------------------------------------------------------
  // Defect 1d — an empty toolset must not be invented from a failed read
  // ---------------------------------------------------------------------------

  it('28 — an unreadable tools table flags unavailability instead of claiming "none declared"', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      tools: () => {
        throw new Error('PostgREST 504 on GET tools')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    errorSpy.mockRestore()

    const node = graph?.nodes.find((n) => n.kind === 'agent')
    expect(node?.toolsUnavailable).toBe(true)
    // The array is still empty — that is deliberate, the canvas keeps drawing.
    // The FLAG is what stops the empty array from being read as a claim.
    expect(node?.tools).toEqual([])
    // Derived tool edges are dropped, as before — the canvas is not blanked.
    expect(graph?.edges.some((e) => e.relation === 'shares-tool')).toBe(false)
    expect(graph?.edges.length).toBeGreaterThan(0)
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()
  })

  it('28b — a genuinely empty toolset is a different fact from an unreadable one', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({ tools: [] })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    const node = graph?.nodes.find((n) => n.kind === 'agent')
    // Read succeeded, nothing came back: "No tool declared." is TRUE here.
    expect(node?.tools).toEqual([])
    expect(node?.toolsUnavailable).toBe(false)
  })

  // ---------------------------------------------------------------------------
  // Defect 1e — freshness must not be ambiguous
  // ---------------------------------------------------------------------------

  it('29 — a null latestActivityAt says WHICH fact it states', async () => {
    // Project that genuinely never ran.
    copilotsHandler = () => [copilot({ id: 'a' })]
    const neverRan = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(neverRan?.freshness.latestActivityAt).toBeNull()
    expect(neverRan?.freshness.latestActivityState).toBe('known')

    // Same null, opposite meaning: the runs could not be read.
    pgrestHandler = routeTables({
      agent_runs: () => {
        throw new Error('PostgREST 504 on GET agent_runs')
      },
    })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unreadable = await getProjectTeamGraph(PROJECT, { now: NOW })
    errorSpy.mockRestore()
    expect(unreadable?.freshness.latestActivityAt).toBeNull()
    expect(unreadable?.freshness.latestActivityState).toBe('unreadable')

    expect(neverRan?.freshness).not.toEqual(unreadable?.freshness)
  })

  it('29b — a readable project reports its activity timestamp as known', async () => {
    copilotsHandler = () => [copilot({ id: 'a' })]
    pgrestHandler = routeTables({
      agent_runs: [runRow({ id: 'r1', copilot_id: 'a', started_at: '2026-07-18T09:30:00.000Z' })],
    })
    const graph = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(graph?.freshness.latestActivityAt).toBe('2026-07-18T09:30:00.000Z')
    expect(graph?.freshness.latestActivityState).toBe('known')
  })

  it('18 — output is deterministic across two identical calls', async () => {
    copilotsHandler = () => [
      copilot({ id: 'c', tags: ['review'] }),
      copilot({ id: 'a', tags: ['review'] }),
      copilot({ id: 'b' }),
    ]
    pgrestHandler = routeTables({
      tools: [
        { id: 't1', name: 'shared_tool', copilot_id: 'a' },
        { id: 't2', name: 'shared_tool', copilot_id: 'b' },
      ],
    })
    const first = await getProjectTeamGraph(PROJECT, { now: NOW })
    const second = await getProjectTeamGraph(PROJECT, { now: NOW })
    expect(JSON.stringify(first)).toBe(JSON.stringify(second))
  })
})
