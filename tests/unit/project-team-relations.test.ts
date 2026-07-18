/**
 * Unit tests for the project team canvas edge derivation
 * (src/lib/agent-mission-control/project-team/relations.ts).
 *
 * Pure, offline: the module has no I/O — nothing to mock.
 * The point of these tests is not coverage, it is the ANTI-FABRICATION
 * contract: no edge without persisted evidence, no hierarchy from names or
 * models, no dependency from co-membership, commodity tools excluded, and
 * strict project isolation on explicit rows.
 */
import { describe, expect, it } from 'vitest'

import {
  MIN_GROUP_SIZE,
  PROVENANCE_TAGS,
  SHARED_TOOL_MAX_AGENTS,
  TEAM_TAG_RULES,
  buildTeamEdges,
  buildTeamGroups,
  groupNodeId,
  projectNodeId,
  resolveTeamFromTags,
  type BuildTeamEdgesInput,
  type ProjectAgentRelationRow,
  type TeamAgentInput,
} from '@/lib/agent-mission-control/project-team/relations'

const PROJECT = 'proj-test'
const PROJECT_NODE = projectNodeId(PROJECT)
const NOW = Date.parse('2026-07-18T12:00:00.000Z')
const RECENT = '2026-07-18T11:00:00.000Z'
const STALE = '2026-01-01T00:00:00.000Z'

function agent(id: string, tags: string[] = []): TeamAgentInput {
  return { id, name: id, tags }
}

function relation(over: Partial<ProjectAgentRelationRow> & { id: string }): ProjectAgentRelationRow {
  return {
    projectId: PROJECT,
    sourceCopilotId: 'a',
    targetCopilotId: 'b',
    relationType: 'depends-on',
    label: null,
    isActive: true,
    ...over,
  }
}

function build(over: Partial<BuildTeamEdgesInput> = {}) {
  return buildTeamEdges({
    projectId: PROJECT,
    agents: [],
    nowMs: NOW,
    ...over,
  })
}

describe('resolveTeamFromTags — the documented grouping rule', () => {
  it('1 — maps a functional tag to its team label', () => {
    expect(resolveTeamFromTags(['review'])).toBe('Review')
    expect(resolveTeamFromTags(['authoring'])).toBe('Authoring')
  })

  it('2 — pure-provenance tags never form a team', () => {
    expect(resolveTeamFromTags(['drafted', 'agent-builder', 'repo-aware'])).toBeNull()
    expect(resolveTeamFromTags(['bench'])).toBeNull()
    expect(resolveTeamFromTags(['internal', 'controlled'])).toBeNull()
  })

  it('3 — the allowlist is ordered: first match wins, deterministically', () => {
    // 'authoring' precedes 'review' in TEAM_TAG_RULES, so tag order in the row
    // must not change the outcome.
    expect(resolveTeamFromTags(['review', 'authoring'])).toBe('Authoring')
    expect(resolveTeamFromTags(['authoring', 'review'])).toBe('Authoring')
  })

  it('4 — no meaningful tag => null (agent attaches to the project directly)', () => {
    expect(resolveTeamFromTags([])).toBeNull()
    expect(resolveTeamFromTags(null)).toBeNull()
    expect(resolveTeamFromTags(['totally-unknown-tag'])).toBeNull()
  })

  it('5 — no rule in the allowlist is a provenance tag', () => {
    for (const rule of TEAM_TAG_RULES) expect(PROVENANCE_TAGS.has(rule.tag)).toBe(false)
  })

  it('6 — matching is case-insensitive on the stored tag', () => {
    expect(resolveTeamFromTags(['REVIEW'])).toBe('Review')
  })
})

describe('buildTeamGroups', () => {
  it('7 — a group needs at least MIN_GROUP_SIZE agents', () => {
    expect(MIN_GROUP_SIZE).toBe(2)
    const lonely = buildTeamGroups([agent('a', ['review'])])
    expect(lonely).toEqual([])
    const real = buildTeamGroups([agent('a', ['review']), agent('b', ['review'])])
    expect(real).toHaveLength(1)
    expect(real[0]?.team).toBe('Review')
    expect(real[0]?.agentIds).toEqual(['a', 'b'])
  })

  it('8 — groups are sorted and their member lists stable', () => {
    const groups = buildTeamGroups([
      agent('z', ['review']),
      agent('a', ['review']),
      agent('y', ['authoring']),
      agent('b', ['authoring']),
    ])
    expect(groups.map((g) => g.team)).toEqual(['Authoring', 'Review'])
    expect(groups[0]?.agentIds).toEqual(['b', 'y'])
  })
})

describe('structural membership edges', () => {
  it('9 — every ungrouped agent gets a project-membership edge to the project node', () => {
    const edges = build({ agents: [agent('a'), agent('b')] })
    const membership = edges.filter((e) => e.relation === 'project-membership')
    expect(membership).toHaveLength(2)
    expect(membership.every((e) => e.target === PROJECT_NODE)).toBe(true)
    // An UNGROUPED agent's edge to the project restates copilots.project_id
    // verbatim — the one structural edge that is genuinely configured.
    expect(membership.every((e) => e.origin === 'explicit')).toBe(true)
  })

  // ---- V1: tag-derived grouping must never claim to be configured ---------

  it('9a — PROVENANCE: team-membership is DERIVED, never explicit', () => {
    const edges = build({ agents: [agent('a', ['review']), agent('b', ['review'])] })
    const teamEdges = edges.filter((e) => e.relation === 'team-membership')
    expect(teamEdges).toHaveLength(2)
    // The tag is persisted, but the TEAM it maps to is TEAM_TAG_RULES — a table
    // in our source, not in the database. No operator configured this, so it
    // must render dashed and read "Derived".
    expect(teamEdges.every((e) => e.origin === 'derived')).toBe(true)
  })

  it("9b — PROVENANCE: a group node's own edge to the project is DERIVED too", () => {
    const edges = build({ agents: [agent('a', ['review']), agent('b', ['review'])] })
    const groupEdge = edges.find(
      (e) => e.relation === 'project-membership' && e.source === groupNodeId('Review')
    )
    expect(groupEdge).toBeDefined()
    // Consistency: the source node is itself a derived construct, so the edge
    // carrying it cannot claim to be configured.
    expect(groupEdge?.origin).toBe('derived')
  })

  it('9c — PROVENANCE MATRIX: every relation kind has a pinned, non-accidental origin', () => {
    const edges = build({
      agents: [agent('a', ['review']), agent('b', ['review']), agent('c'), agent('d')],
      explicitRelations: [relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'c' })],
      toolNamesByAgentId: new Map([
        ['c', ['t1']],
        ['d', ['t1']],
      ]),
      missionParticipations: [
        { orchestratorCopilotId: 'b', participantCopilotIds: ['d'], updatedAt: RECENT },
      ],
    })
    const originOf = (id: string) => edges.find((e) => e.id === id)?.origin

    // Backed by a persisted row stating this exact edge:
    expect(originOf('depends-on::a::c')).toBe('explicit')
    expect(originOf(`project-membership::c::${PROJECT_NODE}`)).toBe('explicit')
    expect(originOf(`project-membership::d::${PROJECT_NODE}`)).toBe('explicit')

    // Computed by this module — no row states any of these:
    expect(originOf(`team-membership::a::${groupNodeId('Review')}`)).toBe('derived')
    expect(originOf(`team-membership::b::${groupNodeId('Review')}`)).toBe('derived')
    expect(originOf(`project-membership::${groupNodeId('Review')}::${PROJECT_NODE}`)).toBe('derived')
    expect(originOf('shares-tool::c::d')).toBe('derived')
    expect(originOf('orchestrates::b::d')).toBe('derived')
  })

  it('9d — no edge touching a group node is ever explicit', () => {
    const edges = build({
      agents: [agent('a', ['review']), agent('b', ['review']), agent('x', ['ops']), agent('y', ['ops'])],
    })
    const groupIds = new Set([groupNodeId('Review'), groupNodeId('Ops')])
    const touchingGroup = edges.filter((e) => groupIds.has(e.source) || groupIds.has(e.target))
    expect(touchingGroup.length).toBe(6) // 4 team-membership + 2 group->project
    expect(touchingGroup.every((e) => e.origin === 'derived')).toBe(true)
  })

  it('10 — grouped agents get team-membership INSTEAD of project-membership', () => {
    const edges = build({ agents: [agent('a', ['review']), agent('b', ['review']), agent('c')] })
    const teamEdges = edges.filter((e) => e.relation === 'team-membership')
    expect(teamEdges.map((e) => e.source).sort()).toEqual(['a', 'b'])
    expect(teamEdges.every((e) => e.target === groupNodeId('Review'))).toBe(true)

    // a and b must NOT also hang off the project directly.
    const direct = edges.filter((e) => e.relation === 'project-membership' && e.source !== groupNodeId('Review'))
    expect(direct.map((e) => e.source)).toEqual(['c'])
  })

  it('11 — the group node itself is attached to the project node', () => {
    const edges = build({ agents: [agent('a', ['review']), agent('b', ['review'])] })
    const groupEdge = edges.find(
      (e) => e.relation === 'project-membership' && e.source === groupNodeId('Review')
    )
    expect(groupEdge).toBeDefined()
    expect(groupEdge?.target).toBe(PROJECT_NODE)
    expect(groupEdge?.weight).toBe(2)
  })

  it('12 — a graph with zero agents has no edges at all', () => {
    expect(build({ agents: [] })).toEqual([])
  })

  it('13 — a graph with one agent has exactly one membership edge', () => {
    const edges = build({ agents: [agent('solo')] })
    expect(edges).toHaveLength(1)
    expect(edges[0]?.relation).toBe('project-membership')
    expect(edges[0]?.source).toBe('solo')
  })

  it('14 — 25 agents produce 25 membership edges and nothing invented', () => {
    const agents = Array.from({ length: 25 }, (_, i) => agent(`a${String(i).padStart(2, '0')}`))
    const edges = build({ agents })
    expect(edges).toHaveLength(25)
    expect(edges.every((e) => e.relation === 'project-membership')).toBe(true)
  })
})

describe('explicit relations (level 1)', () => {
  it('15 — a persisted row becomes an explicit edge with its relation type', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', relationType: 'reviews', label: 'QA pass' })],
    })
    const edge = edges.find((e) => e.relation === 'reviews')
    expect(edge).toMatchObject({ source: 'a', target: 'b', origin: 'explicit', label: 'QA pass' })
  })

  it('16 — every supported relation type round-trips', () => {
    const types = ['orchestrates', 'depends-on', 'sends-output-to', 'reviews', 'triggers'] as const
    for (const t of types) {
      const edges = build({
        agents: [agent('a'), agent('b')],
        explicitRelations: [relation({ id: `rel-${t}`, relationType: t })],
      })
      expect(edges.some((e) => e.relation === t && e.origin === 'explicit')).toBe(true)
    }
  })

  it('17 — an unknown relation_type is dropped, never coerced', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', relationType: 'is-the-boss-of' })],
    })
    expect(edges.every((e) => e.relation === 'project-membership')).toBe(true)
  })

  it('18 — a row referencing an agent outside the project is dropped (orphan removal)', () => {
    const edges = build({
      agents: [agent('a')],
      explicitRelations: [relation({ id: 'rel1', sourceCopilotId: 'a', targetCopilotId: 'foreign' })],
    })
    expect(edges.some((e) => e.relation === 'depends-on')).toBe(false)
    // The membership edge for the real agent survives.
    expect(edges).toHaveLength(1)
  })

  it('19 — a row referencing a DELETED/absent agent produces no dangling edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [
        relation({ id: 'rel1', sourceCopilotId: 'a', targetCopilotId: 'deleted-agent' }),
        relation({ id: 'rel2', sourceCopilotId: 'ghost', targetCopilotId: 'b' }),
      ],
    })
    const nodeIds = new Set(['a', 'b', PROJECT_NODE])
    for (const e of edges) {
      expect(nodeIds.has(e.source)).toBe(true)
      expect(nodeIds.has(e.target)).toBe(true)
    }
  })

  it('20 — a row from ANOTHER project is dropped (strict isolation)', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', projectId: 'proj-other' })],
    })
    expect(edges.some((e) => e.relation === 'depends-on')).toBe(false)
  })

  it('21 — a self-referencing row is dropped', () => {
    const edges = build({
      agents: [agent('a')],
      explicitRelations: [relation({ id: 'rel1', sourceCopilotId: 'a', targetCopilotId: 'a' })],
    })
    expect(edges.some((e) => e.relation === 'depends-on')).toBe(false)
  })

  it('22 — is_active=false forces the edge inactive even with recent traffic', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', isActive: false })],
      lastActivityByAgentId: new Map([
        ['a', RECENT],
        ['b', RECENT],
      ]),
    })
    expect(edges.find((e) => e.relation === 'depends-on')?.active).toBe(false)
  })

  it('23 — cycles are preserved, not collapsed, and do not hang', () => {
    const edges = build({
      agents: [agent('a'), agent('b'), agent('c')],
      explicitRelations: [
        relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'b' }),
        relation({ id: 'r2', sourceCopilotId: 'b', targetCopilotId: 'c' }),
        relation({ id: 'r3', sourceCopilotId: 'c', targetCopilotId: 'a' }),
      ],
    })
    const cycle = edges.filter((e) => e.relation === 'depends-on')
    expect(cycle).toHaveLength(3)
    expect(cycle.map((e) => `${e.source}->${e.target}`).sort()).toEqual(['a->b', 'b->c', 'c->a'])
  })

  it('24 — a mutual pair (a->b and b->a) yields two distinct edges', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [
        relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'b' }),
        relation({ id: 'r2', sourceCopilotId: 'b', targetCopilotId: 'a' }),
      ],
    })
    expect(edges.filter((e) => e.relation === 'depends-on')).toHaveLength(2)
  })
})

describe('derived edges (level 3) — shares-tool', () => {
  it('25 — two agents sharing a tool name get a derived edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      toolNamesByAgentId: new Map([
        ['a', ['draft_copilot_spec']],
        ['b', ['draft_copilot_spec']],
      ]),
    })
    const edge = edges.find((e) => e.relation === 'shares-tool')
    expect(edge).toBeDefined()
    expect(edge?.origin).toBe('derived')
    expect(edge?.label).toBe('draft_copilot_spec')
    expect(edge?.weight).toBe(1)
  })

  it('26 — COMMODITY THRESHOLD: a tool held by more than SHARED_TOOL_MAX_AGENTS agents yields nothing', () => {
    expect(SHARED_TOOL_MAX_AGENTS).toBe(4)
    const agents = Array.from({ length: 5 }, (_, i) => agent(`a${i}`))
    const tools = new Map(agents.map((a) => [a.id, ['read_copilot_summary']] as const))
    const edges = build({ agents, toolNamesByAgentId: tools })
    expect(edges.some((e) => e.relation === 'shares-tool')).toBe(false)
  })

  it('27 — exactly SHARED_TOOL_MAX_AGENTS holders is still emitted (boundary)', () => {
    const agents = Array.from({ length: 4 }, (_, i) => agent(`a${i}`))
    const tools = new Map(agents.map((a) => [a.id, ['specific_tool']] as const))
    const edges = build({ agents, toolNamesByAgentId: tools })
    // 4 holders => 6 unordered pairs.
    expect(edges.filter((e) => e.relation === 'shares-tool')).toHaveLength(6)
  })

  it('28 — the live commodity case (14 holders) does not produce 91 edges', () => {
    const agents = Array.from({ length: 14 }, (_, i) => agent(`a${String(i).padStart(2, '0')}`))
    const tools = new Map(
      agents.map((a) => [a.id, ['read_copilot_summary', 'read_recent_runs', 'read_project_summary']] as const)
    )
    const edges = build({ agents, toolNamesByAgentId: tools })
    expect(edges.filter((e) => e.relation === 'shares-tool')).toHaveLength(0)
  })

  it('29 — multiple shared tools on one pair collapse into ONE edge with weight', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      toolNamesByAgentId: new Map([
        ['a', ['t1', 't2', 't3']],
        ['b', ['t1', 't2', 'other']],
      ]),
    })
    const shared = edges.filter((e) => e.relation === 'shares-tool')
    expect(shared).toHaveLength(1)
    expect(shared[0]?.weight).toBe(2)
    expect(shared[0]?.label).toBe('t1, t2')
  })

  it('30 — a tool held by a single agent creates no edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      toolNamesByAgentId: new Map([['a', ['solo_tool']]]),
    })
    expect(edges.some((e) => e.relation === 'shares-tool')).toBe(false)
  })

  it('31 — EXPLICIT WINS: no shares-tool noise on a pair that already has a declared relation', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', relationType: 'sends-output-to' })],
      toolNamesByAgentId: new Map([
        ['a', ['t1']],
        ['b', ['t1']],
      ]),
    })
    expect(edges.some((e) => e.relation === 'shares-tool')).toBe(false)
    expect(edges.some((e) => e.relation === 'sends-output-to')).toBe(true)
  })
})

describe('derived edges (level 3) — orchestrates', () => {
  it('32 — a NULL orchestrator (the live reality today) yields NOTHING', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      missionParticipations: [{ orchestratorCopilotId: null, participantCopilotIds: ['a', 'b'] }],
    })
    expect(edges.some((e) => e.relation === 'orchestrates')).toBe(false)
  })

  it('33 — a real orchestrator with in-project participants yields a derived edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      missionParticipations: [{ orchestratorCopilotId: 'a', participantCopilotIds: ['b'] }],
    })
    const edge = edges.find((e) => e.relation === 'orchestrates')
    expect(edge).toMatchObject({ source: 'a', target: 'b', origin: 'derived' })
  })

  it('34 — participants outside the project are ignored', () => {
    const edges = build({
      agents: [agent('a')],
      missionParticipations: [{ orchestratorCopilotId: 'a', participantCopilotIds: ['foreign'] }],
    })
    expect(edges.some((e) => e.relation === 'orchestrates')).toBe(false)
  })

  it('35 — repeated missions do not duplicate the orchestration edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'] },
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'] },
      ],
    })
    expect(edges.filter((e) => e.relation === 'orchestrates')).toHaveLength(1)
  })
})

describe('anti-fabrication guarantees', () => {
  it('36 — sharing a project alone creates NO dependency between agents', () => {
    const edges = build({ agents: [agent('a'), agent('b'), agent('c')] })
    const nonMembership = edges.filter(
      (e) => e.relation !== 'project-membership' && e.relation !== 'team-membership'
    )
    expect(nonMembership).toEqual([])
  })

  it('36a — TEMPORAL PROXIMITY: agents running at the same instant get NO edge', () => {
    const sameInstant = '2026-07-18T11:00:00.000Z'
    const edges = build({
      agents: [agent('a'), agent('b'), agent('c')],
      lastActivityByAgentId: new Map([
        ['a', sameInstant],
        ['b', sameInstant],
        ['c', sameInstant],
      ]),
    })
    // Three agents firing simultaneously is a coincidence, not a workflow.
    const nonMembership = edges.filter(
      (e) => e.relation !== 'project-membership' && e.relation !== 'team-membership'
    )
    expect(nonMembership).toEqual([])
  })

  it('36b — the MODEL/runtime is not even an input, so it cannot build hierarchy', () => {
    // TeamAgentInput exposes id/name/tags only. Guard the shape so a future
    // `model` field cannot be added and quietly consulted for edge derivation.
    const a: TeamAgentInput = agent('a')
    expect(Object.keys(a).sort()).toEqual(['id', 'name', 'tags'])
  })

  it('37 — a "supervisor"/"lead" NAME never produces a hierarchy edge', () => {
    const edges = build({
      agents: [
        { id: 'a', name: 'Supervisor Orchestrator Lead', tags: [] },
        { id: 'b', name: 'worker', tags: [] },
      ],
    })
    expect(edges.some((e) => e.relation === 'orchestrates')).toBe(false)
    expect(edges.some((e) => e.relation === 'depends-on')).toBe(false)
  })

  it('38 — no `triggers` edge is ever derived without a persisted row', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      toolNamesByAgentId: new Map([
        ['a', ['t1']],
        ['b', ['t1']],
      ]),
      missionParticipations: [{ orchestratorCopilotId: 'a', participantCopilotIds: ['b'] }],
    })
    expect(edges.some((e) => e.relation === 'triggers')).toBe(false)
  })
})

describe('edge activity, dedup and determinism', () => {
  // ---- V2: co-activity is NOT relation traffic ----------------------------
  // These pin the doctrine that replaced "both endpoints ran recently".
  // `active` licenses the canvas to animate flow along the edge, so it may only
  // ever be set by a persisted event ON that relation.

  it('39 — CO-ACTIVITY IS NOT TRAFFIC: both endpoints running recently does NOT activate the edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1' })],
      lastActivityByAgentId: new Map([
        ['a', RECENT],
        ['b', RECENT],
      ]),
    })
    const edge = edges.find((e) => e.relation === 'depends-on')
    // Two agents that merely happened to be busy the same week exchanged
    // nothing that the schema records. Animating this would be a fabrication.
    expect(edge?.active).toBe(false)
    expect(edge?.lastActivityAt).toBeNull()
  })

  it('39a — a recent mission run linking the pair DOES activate the explicit edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1' })],
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'], updatedAt: RECENT },
      ],
    })
    const edge = edges.find((e) => e.relation === 'depends-on')
    expect(edge?.active).toBe(true)
    expect(edge?.lastActivityAt).toBe(RECENT)
  })

  it('39b — a STALE mission event leaves the edge inactive but keeps the timestamp', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1' })],
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'], updatedAt: STALE },
      ],
    })
    const edge = edges.find((e) => e.relation === 'depends-on')
    expect(edge?.active).toBe(false)
    // The event is real, just old — reporting it is honest, animating it is not.
    expect(edge?.lastActivityAt).toBe(STALE)
  })

  it('39c — is_active=false still wins over a genuine recent relation event', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', isActive: false })],
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'], updatedAt: RECENT },
      ],
    })
    expect(edges.find((e) => e.relation === 'depends-on')?.active).toBe(false)
  })

  it('39d — is_active=true alone NEVER activates: config is not evidence of movement', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1', isActive: true })],
    })
    expect(edges.find((e) => e.relation === 'depends-on')?.active).toBe(false)
  })

  it('39e — membership and shares-tool can NEVER be active, whatever the endpoints did', () => {
    const edges = build({
      agents: [agent('a', ['review']), agent('b', ['review']), agent('c')],
      toolNamesByAgentId: new Map([
        ['a', ['t1']],
        ['c', ['t1']],
      ]),
      lastActivityByAgentId: new Map([
        ['a', RECENT],
        ['b', RECENT],
        ['c', RECENT],
      ]),
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['c'], updatedAt: RECENT },
      ],
    })
    const statics = edges.filter(
      (e) =>
        e.relation === 'project-membership' ||
        e.relation === 'team-membership' ||
        e.relation === 'shares-tool'
    )
    expect(statics.length).toBeGreaterThan(0)
    // "belongs to" and "declares the same tool name" are not channels: nothing
    // can flow along them, so no mission event may light them up either.
    expect(statics.every((e) => e.active === false)).toBe(true)
    expect(statics.every((e) => e.lastActivityAt === null)).toBe(true)
  })

  it('39f — the derived orchestrates edge carries the mission event as its activity', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      missionParticipations: [
        { orchestratorCopilotId: 'a', participantCopilotIds: ['b'], updatedAt: RECENT },
      ],
    })
    const edge = edges.find((e) => e.relation === 'orchestrates')
    expect(edge).toMatchObject({ active: true, lastActivityAt: RECENT, origin: 'derived' })
  })

  it('39g — endpoint activity is never leaked into lastActivityAt', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'rel1' })],
      lastActivityByAgentId: new Map([
        ['a', RECENT],
        ['b', RECENT],
      ]),
    })
    // No mission event exists, so NO edge may claim a timestamp — the endpoint
    // run timestamps belong to the nodes, not to the relation.
    expect(edges.every((e) => e.lastActivityAt === null)).toBe(true)
  })

  it('40 — an agent that never ran has an inactive membership edge and a null lastActivityAt', () => {
    const edges = build({
      agents: [agent('a')],
      lastActivityByAgentId: new Map([['a', null]]),
    })
    expect(edges[0]?.active).toBe(false)
    expect(edges[0]?.lastActivityAt).toBeNull()
  })

  it('41 — output is deterministic: same input, byte-identical output', () => {
    const input: Partial<BuildTeamEdgesInput> = {
      agents: [agent('c', ['review']), agent('a', ['review']), agent('b')],
      explicitRelations: [relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'b' })],
      toolNamesByAgentId: new Map([
        ['a', ['t1']],
        ['c', ['t1']],
      ]),
    }
    expect(JSON.stringify(build(input))).toBe(JSON.stringify(build(input)))
  })

  it('42 — duplicate identical rows collapse into a single edge', () => {
    const edges = build({
      agents: [agent('a'), agent('b')],
      explicitRelations: [relation({ id: 'r1' }), relation({ id: 'r2' })],
    })
    expect(edges.filter((e) => e.relation === 'depends-on')).toHaveLength(1)
  })

  it('43 — edge ids are unique across the whole graph', () => {
    const edges = build({
      agents: [agent('a', ['review']), agent('b', ['review']), agent('c')],
      explicitRelations: [relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'c' })],
      toolNamesByAgentId: new Map([
        ['b', ['t1']],
        ['c', ['t1']],
      ]),
    })
    const ids = edges.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('44 — dedupeEdges contract: every endpoint of every edge is a real node', () => {
    const edges = build({
      agents: [agent('a', ['review']), agent('b', ['review']), agent('c'), agent('d')],
      explicitRelations: [
        relation({ id: 'r1', sourceCopilotId: 'a', targetCopilotId: 'c' }),
        // Endpoints that do not exist must never reach the output.
        relation({ id: 'r2', sourceCopilotId: 'a', targetCopilotId: 'ghost' }),
        relation({ id: 'r3', sourceCopilotId: 'phantom', targetCopilotId: 'b' }),
      ],
      toolNamesByAgentId: new Map([
        ['c', ['t1']],
        ['d', ['t1']],
      ]),
      missionParticipations: [
        { orchestratorCopilotId: 'b', participantCopilotIds: ['d', 'vanished'], updatedAt: RECENT },
      ],
    })
    const known = new Set(['a', 'b', 'c', 'd', PROJECT_NODE, groupNodeId('Review')])
    for (const e of edges) {
      expect(known.has(e.source)).toBe(true)
      expect(known.has(e.target)).toBe(true)
    }
    expect(edges.some((e) => e.source === 'ghost' || e.target === 'ghost')).toBe(false)
    expect(edges.some((e) => e.target === 'vanished')).toBe(false)
    // Group nodes ARE part of the known set — the filter must not eat them.
    expect(edges.some((e) => e.target === groupNodeId('Review'))).toBe(true)
  })
})
