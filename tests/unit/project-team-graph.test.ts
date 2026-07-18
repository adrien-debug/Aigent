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

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => pgrestHandler(method, path, body)),
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

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async (id: string) => projectHandler(id)),
  getCopilots: vi.fn(async () => copilotsHandler()),
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

/** Route the mocked pgrest by table name. */
function routeTables(tables: {
  agent_runs?: Record<string, unknown>[] | (() => never)
  tools?: Record<string, unknown>[] | (() => never)
  project_agent_relations?: Record<string, unknown>[] | (() => never)
  mission_runs?: Record<string, unknown>[] | (() => never)
}): PgrestHandler {
  return (_method, path) => {
    const table = path.split('?')[0] as keyof typeof tables
    const value = tables[table]
    if (typeof value === 'function') return value()
    return value ?? []
  }
}

describe('getProjectTeamGraph', () => {
  beforeEach(() => {
    projectHandler = (id) => (id === PROJECT ? { id: PROJECT, name: 'Test Project', slug: 'test', description: 'd' } : undefined)
    copilotsHandler = () => []
    pgrestHandler = routeTables({})
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
    // successRate stays null — an unread run set is NOT a 0% success rate.
    expect(node?.metrics.successRate).toBeNull()
    expect(graph?.freshness.latestActivityAt).toBeNull()
    expect(() => parseProjectTeamGraph(graph)).not.toThrow()

    errorSpy.mockRestore()
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
      queriedTables.push(path.split('?')[0] as string)
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
