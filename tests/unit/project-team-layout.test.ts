import { describe, expect, it } from 'vitest'

import {
  TEAM_LAYOUT,
  TEAM_NODE_SIZE,
  computeTeamLayout,
  teamLayoutSignature,
  type TeamLayoutInputEdge,
  type TeamLayoutInputNode,
  type TeamNodeBox,
} from '@/lib/agent-mission-control/project-team/layout'

// ---------------------------------------------------------------------------
// Fixtures — synthetic graph shapes, NOT copies of production data. They exist
// only to exercise geometry (counts, grouping, cycles), which is all the layout
// engine reads.
// ---------------------------------------------------------------------------

const PROJECT: TeamLayoutInputNode = { id: 'proj-1', kind: 'project', name: 'Project One', slug: 'project-one' }

function agent(index: number, team?: string): TeamLayoutInputNode {
  return {
    id: `agent-${String(index).padStart(3, '0')}`,
    kind: 'agent',
    name: `Agent ${String(index).padStart(3, '0')}`,
    slug: `agent-${index}`,
    team: team ?? null,
  }
}

function group(id: string, name = id): TeamLayoutInputNode {
  return { id, kind: 'group', name, slug: id }
}

/** N agents, no groups, attached straight to the project. */
function flatGraph(count: number): { nodes: TeamLayoutInputNode[]; edges: TeamLayoutInputEdge[] } {
  const nodes: TeamLayoutInputNode[] = [PROJECT]
  const edges: TeamLayoutInputEdge[] = []
  for (let i = 0; i < count; i += 1) {
    nodes.push(agent(i))
    edges.push({ source: PROJECT.id, target: `agent-${String(i).padStart(3, '0')}`, relation: 'project-membership' })
  }
  return { nodes, edges }
}

/** `count` agents spread round-robin over `groupCount` groups via explicit edges. */
function groupedGraph(
  count: number,
  groupCount: number
): { nodes: TeamLayoutInputNode[]; edges: TeamLayoutInputEdge[]; groupIds: string[] } {
  const groupIds = Array.from({ length: groupCount }, (_, i) => `team-${String(i).padStart(2, '0')}`)
  const nodes: TeamLayoutInputNode[] = [PROJECT, ...groupIds.map((id) => group(id))]
  const edges: TeamLayoutInputEdge[] = groupIds.map((id) => ({
    source: PROJECT.id,
    target: id,
    relation: 'project-membership',
  }))
  for (let i = 0; i < count; i += 1) {
    const node = agent(i)
    nodes.push(node)
    edges.push({ source: groupIds[i % groupCount], target: node.id, relation: 'team-membership' })
  }
  return { nodes, edges, groupIds }
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Edge-to-edge gap between two boxes. Negative ⇒ they overlap. */
function gapBetween(a: TeamNodeBox, b: TeamNodeBox): number {
  const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width))
  const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height))
  // Boxes overlap on both axes only when BOTH gaps are negative; separation on
  // either axis is enough to keep them apart, so the larger gap is the real one.
  return Math.max(dx, dy)
}

function centreOf(box: TeamNodeBox): { x: number; y: number } {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function distance(a: TeamNodeBox, b: TeamNodeBox): number {
  const ca = centreOf(a)
  const cb = centreOf(b)
  return Math.hypot(ca.x - cb.x, ca.y - cb.y)
}

/** Assert every pair of placed boxes clears the documented minimum separation. */
function expectNoCollisions(positions: Map<string, TeamNodeBox>): void {
  const entries = [...positions.entries()]
  const offenders: string[] = []
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const gap = gapBetween(entries[i][1], entries[j][1])
      if (gap < TEAM_LAYOUT.MIN_NODE_SEPARATION) {
        offenders.push(`${entries[i][0]} ↔ ${entries[j][0]} (gap ${gap.toFixed(1)}px)`)
      }
    }
  }
  expect(offenders).toEqual([])
}

// ---------------------------------------------------------------------------

describe('computeTeamLayout — determinism', () => {
  it('produces byte-identical output for the same input, twice', () => {
    const { nodes, edges } = groupedGraph(31, 5)
    const first = computeTeamLayout(nodes, edges)
    const second = computeTeamLayout(nodes, edges)

    expect(JSON.stringify([...second.positions])).toBe(JSON.stringify([...first.positions]))
    expect(second.bounds).toEqual(first.bounds)
    expect(second.orientation).toBe(first.orientation)
    expect(second.centre).toEqual(first.centre)
  })

  it('is independent of input ordering (nodes and edges shuffled)', () => {
    const { nodes, edges } = groupedGraph(23, 4)
    const reference = computeTeamLayout(nodes, edges)
    const shuffled = computeTeamLayout([...nodes].reverse(), [...edges].reverse())

    expect(JSON.stringify([...shuffled.positions].sort())).toBe(
      JSON.stringify([...reference.positions].sort())
    )
  })

  it('yields integer coordinates (no sub-pixel drift between runs)', () => {
    const { nodes, edges } = groupedGraph(17, 3)
    for (const box of computeTeamLayout(nodes, edges).positions.values()) {
      expect(Number.isInteger(box.x)).toBe(true)
      expect(Number.isInteger(box.y)).toBe(true)
    }
  })
})

describe('computeTeamLayout — totality', () => {
  it('places every input node exactly once', () => {
    const { nodes, edges } = groupedGraph(40, 6)
    const { positions } = computeTeamLayout(nodes, edges)
    expect(positions.size).toBe(nodes.length)
    for (const node of nodes) expect(positions.has(node.id)).toBe(true)
  })

  it('renders each node at its declared kind size', () => {
    const { nodes, edges } = groupedGraph(9, 2)
    const { positions } = computeTeamLayout(nodes, edges)
    for (const node of nodes) {
      const box = positions.get(node.id)
      expect(box).toBeDefined()
      const expected = TEAM_NODE_SIZE[node.kind as keyof typeof TEAM_NODE_SIZE]
      expect({ width: box?.width, height: box?.height }).toEqual(expected)
    }
  })

  it('does not drop an extra project node (orphan shelf)', () => {
    const { nodes, edges } = flatGraph(4)
    const extra: TeamLayoutInputNode = { id: 'proj-2', kind: 'project', name: 'Project Two', slug: 'p2' }
    const { positions } = computeTeamLayout([...nodes, extra], edges)
    expect(positions.has('proj-2')).toBe(true)
    expectNoCollisions(positions)
  })
})

describe('computeTeamLayout — no collisions at every scale', () => {
  for (const count of [0, 1, 2, 7, 25, 75, 120]) {
    it(`keeps ${count} ungrouped agent(s) apart`, () => {
      const { nodes, edges } = flatGraph(count)
      const { positions } = computeTeamLayout(nodes, edges)
      expect(positions.size).toBe(count + 1)
      expectNoCollisions(positions)
    })
  }

  for (const [count, groupCount] of [
    [0, 1],
    [1, 1],
    [25, 4],
    [75, 6],
    [75, 12],
    [120, 20],
  ] as const) {
    it(`keeps ${count} agent(s) across ${groupCount} group(s) apart`, () => {
      const { nodes, edges } = groupedGraph(count, groupCount)
      const { positions } = computeTeamLayout(nodes, edges)
      expectNoCollisions(positions)
    })
  }

  it('handles an empty graph', () => {
    const { positions, bounds } = computeTeamLayout([], [])
    expect(positions.size).toBe(0)
    expect(bounds.width).toBeGreaterThan(0)
    expect(bounds.height).toBeGreaterThan(0)
  })

  it('handles a lone project node', () => {
    const { positions, bounds } = computeTeamLayout([PROJECT], [])
    const box = positions.get(PROJECT.id)
    expect(box).toBeDefined()
    expect(bounds.width).toBeGreaterThanOrEqual(TEAM_NODE_SIZE.project.width)
  })
})

describe('computeTeamLayout — grouping', () => {
  it('places an agent nearer to its own group than to any other group', () => {
    const { nodes, edges, groupIds } = groupedGraph(24, 4)
    const { positions } = computeTeamLayout(nodes, edges)

    for (let i = 0; i < 24; i += 1) {
      const agentId = `agent-${String(i).padStart(3, '0')}`
      const ownGroupId = groupIds[i % groupIds.length]
      const agentBox = positions.get(agentId)!
      const ownDistance = distance(agentBox, positions.get(ownGroupId)!)

      for (const otherId of groupIds) {
        if (otherId === ownGroupId) continue
        expect(ownDistance).toBeLessThan(distance(agentBox, positions.get(otherId)!))
      }
    }
  })

  it('resolves membership from the `team` label when no explicit edge exists', () => {
    const nodes: TeamLayoutInputNode[] = [
      PROJECT,
      group('team-alpha', 'Alpha'),
      group('team-beta', 'Beta'),
      { ...agent(0), team: 'team-alpha' },
      { ...agent(1), team: 'Beta' },
    ]
    const { positions } = computeTeamLayout(nodes, [])

    expect(distance(positions.get('agent-000')!, positions.get('team-alpha')!)).toBeLessThan(
      distance(positions.get('agent-000')!, positions.get('team-beta')!)
    )
    expect(distance(positions.get('agent-001')!, positions.get('team-beta')!)).toBeLessThan(
      distance(positions.get('agent-001')!, positions.get('team-alpha')!)
    )
  })

  it('is unaffected by edge direction on team-membership', () => {
    const base = groupedGraph(12, 3)
    const flipped = base.edges.map((e) =>
      e.relation === 'team-membership' ? { source: e.target, target: e.source, relation: e.relation } : e
    )
    const reference = computeTeamLayout(base.nodes, base.edges)
    const reversed = computeTeamLayout(base.nodes, flipped)
    expect(JSON.stringify([...reversed.positions])).toBe(JSON.stringify([...reference.positions]))
  })
})

describe('computeTeamLayout — hostile graphs', () => {
  it('survives a cycle in the edge set', () => {
    const { nodes, edges } = groupedGraph(9, 3)
    const cyclic: TeamLayoutInputEdge[] = [
      ...edges,
      { source: 'agent-000', target: 'agent-001', relation: 'depends-on' },
      { source: 'agent-001', target: 'agent-002', relation: 'depends-on' },
      { source: 'agent-002', target: 'agent-000', relation: 'depends-on' },
      // Self-loop and a membership cycle between two groups.
      { source: 'agent-000', target: 'agent-000', relation: 'triggers' },
      { source: 'team-00', target: 'team-01', relation: 'team-membership' },
      { source: 'team-01', target: 'team-00', relation: 'team-membership' },
    ]
    const { positions } = computeTeamLayout(nodes, cyclic)
    expect(positions.size).toBe(nodes.length)
    expectNoCollisions(positions)
  })

  it('ignores edges pointing at unknown node ids', () => {
    const { nodes, edges } = flatGraph(5)
    const dangling: TeamLayoutInputEdge[] = [
      ...edges,
      { source: 'ghost-group', target: 'agent-000', relation: 'team-membership' },
      { source: 'agent-000', target: 'ghost-agent', relation: 'depends-on' },
    ]
    const { positions } = computeTeamLayout(nodes, dangling)
    expect(positions.size).toBe(nodes.length)
    expectNoCollisions(positions)
  })

  it('falls back to ungrouped when the team label matches no group', () => {
    const nodes = [PROJECT, group('team-alpha'), { ...agent(0), team: 'nowhere' }]
    const { positions } = computeTeamLayout(nodes, [])
    expect(positions.size).toBe(3)
    expectNoCollisions(positions)
  })
})

describe('computeTeamLayout — bounded aspect ratio', () => {
  for (const [count, groupCount] of [
    [25, 0],
    [75, 0],
    [200, 0],
    [75, 6],
    [120, 20],
    [200, 25],
  ] as const) {
    it(`stays within a readable aspect ratio at ${count} agents / ${groupCount} groups`, () => {
      const graph = groupCount === 0 ? flatGraph(count) : groupedGraph(count, groupCount)
      const { bounds } = computeTeamLayout(graph.nodes, graph.edges)
      const aspect = bounds.width / bounds.height
      expect(aspect).toBeGreaterThan(0.25)
      expect(aspect).toBeLessThan(4)
    })
  }

  it('wraps a large flat roster into rows instead of one endless line', () => {
    const { nodes, edges } = flatGraph(75)
    const { positions, bounds } = computeTeamLayout(nodes, edges)
    const distinctRows = new Set([...positions.values()].map((b) => b.y))
    expect(distinctRows.size).toBeGreaterThan(2)
    // A single 75-wide line would be far past this.
    expect(bounds.width).toBeLessThan(75 * TEAM_NODE_SIZE.agent.width)
  })
})

describe('computeTeamLayout — orientation density switch', () => {
  it('is radial while the cluster count fits on one ring', () => {
    const { nodes, edges } = groupedGraph(12, 4)
    expect(computeTeamLayout(nodes, edges).orientation).toBe('radial')
  })

  it('leaves radial once the cluster count exceeds the ring budget', () => {
    const { nodes, edges } = groupedGraph(60, TEAM_LAYOUT.RING_MAX_CLUSTERS + 4)
    expect(computeTeamLayout(nodes, edges).orientation).not.toBe('radial')
  })

  it('hangs a single team BELOW the project, never above it', () => {
    const { nodes, edges } = groupedGraph(4, 1)
    const { positions } = computeTeamLayout(nodes, edges)
    const projectCentre = centreOf(positions.get(PROJECT.id)!)
    const groupCentre = centreOf(positions.get('team-00')!)
    expect(groupCentre.y).toBeGreaterThan(projectCentre.y)
  })

  it('does not put one or two clusters on a ring', () => {
    // A ring reserves each cluster's circumradius in every direction, which
    // for one or two wide, flat clusters wastes the short axis badly.
    const one = groupedGraph(5, 1)
    const two = groupedGraph(8, 2)
    expect(computeTeamLayout(one.nodes, one.edges).orientation).not.toBe('radial')
    expect(computeTeamLayout(two.nodes, two.edges).orientation).not.toBe('radial')
  })

  it('keeps a readable aspect for the small cluster counts a ring would ruin', () => {
    // Regression guard: on a ring these measured 0.51 (n=1) and 4.49 (n=2).
    for (const groupCount of [1, 2]) {
      const { nodes, edges } = groupedGraph(10, groupCount)
      const { bounds } = computeTeamLayout(nodes, edges)
      const aspect = bounds.width / bounds.height
      expect(aspect).toBeGreaterThan(0.6)
      expect(aspect).toBeLessThan(2.5)
    }
  })

  it('keeps the project node at the composition centre in radial mode', () => {
    const { nodes, edges } = groupedGraph(12, 4)
    const { positions, centre, orientation } = computeTeamLayout(nodes, edges)
    expect(orientation).toBe('radial')
    const projectCentre = centreOf(positions.get(PROJECT.id)!)
    expect(Math.abs(projectCentre.x - centre.x)).toBeLessThanOrEqual(1)
    expect(Math.abs(projectCentre.y - centre.y)).toBeLessThanOrEqual(1)
  })
})

describe('teamLayoutSignature', () => {
  it('is stable across node ordering', () => {
    const { nodes, edges } = groupedGraph(10, 2)
    expect(teamLayoutSignature([...nodes].reverse(), [...edges].reverse())).toBe(
      teamLayoutSignature(nodes, edges)
    )
  })

  it('does NOT change when only status/metrics change (no relayout on refresh)', () => {
    const { nodes, edges } = groupedGraph(10, 2)
    const before = teamLayoutSignature(nodes, edges)
    // Simulate a status poll: same set, different runtime facts.
    const refreshed = nodes.map((n) => ({ ...n, status: 'blocked', metrics: { totalRuns: 99 } }))
    expect(teamLayoutSignature(refreshed, edges)).toBe(before)
  })

  it('changes when a node enters or leaves the visible set', () => {
    const { nodes, edges } = groupedGraph(10, 2)
    const before = teamLayoutSignature(nodes, edges)
    expect(teamLayoutSignature(nodes.slice(0, -1), edges)).not.toBe(before)
    expect(teamLayoutSignature([...nodes, agent(999)], edges)).not.toBe(before)
  })

  it('changes when a membership edge changes', () => {
    const { nodes, edges } = groupedGraph(10, 2)
    const before = teamLayoutSignature(nodes, edges)
    const firstMembership = edges.findIndex((e) => e.relation === 'team-membership')
    expect(firstMembership).toBeGreaterThanOrEqual(0)
    const moved = edges.map((e, i) =>
      i === firstMembership ? { ...e, source: e.source === 'team-00' ? 'team-01' : 'team-00' } : e
    )
    expect(teamLayoutSignature(nodes, moved)).not.toBe(before)
  })
})
