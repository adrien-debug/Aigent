/**
 * AIG-STABILIZATION-003 · C8 — unit coverage of `reconcileAssistants()`
 * (src/lib/agent-mission-control/reconcile-assistants.ts).
 *
 * Pure, OFFLINE: the two real I/O boundaries the module reaches — the LangGraph
 * Agent Server (`listAssistants()`) and the gpu1 PostgREST perimeter (`pgrest`)
 * — are mocked at module level (vi.mock is hoisted). NO network, NO LangGraph
 * server, NO DB, NO secret. `assistantIdForCopilot` (the deterministic v5 id
 * function) is used FOR REAL so `driftV5` is exercised against the same math the
 * production code uses — a hand-rolled fake id would let a mapping bug hide.
 *
 * Fixtures cover the four independent divergence classes the module must
 * classify, with the exact seams the frozen spec names:
 *   - stale        — DB records an assistant_id the server does NOT have;
 *   - orphan       — a server assistant (on OUR graph) claimed by NO DB row;
 *   - driftV5      — a copilot whose stored id ≠ assistantIdForCopilot(id);
 *   - inertPhantom — a non-langgraph copilot still carrying an assistant_id.
 * Plus: the classes are INDEPENDENT (one copilot can land in several), a clean
 * baseline yields four empty classes, an assistant on ANOTHER graph is NOT an
 * orphan, and a project-claimed id is NOT an orphan (projects claim ids too).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { assistantIdForCopilot } from '@/lib/agent-mission-control/langgraph-assistants'
import { AGENT_BUILDER_GRAPH_ID } from '@/lib/agent-mission-control/langgraph-client'

// ---------------------------------------------------------------------------
// Module-level mocks (hoisted). The reconcile module imports:
//   - listAssistants from './langgraph-explorer'
//   - pgrest         from './postgrest'
// Both are server-only; we replace them with in-memory stubs driven by the
// per-test fixtures below. `server-only` itself is a no-op under vitest's
// react-server condition (see vitest.config.ts), so it needs no mock.
// ---------------------------------------------------------------------------

interface ServerAssistant {
  assistantId: string
  name: string | null
  graphId?: string
}
interface CopilotRow {
  id: string
  name: string | null
  assistant_id: string | null
  runtime: string
  project_id: string | null
}
interface ProjectRow {
  id: string
  name: string | null
  assistant_id: string | null
}

let serverAssistants: ServerAssistant[] = []
let copilotRows: CopilotRow[] = []
let projectRows: ProjectRow[] = []

vi.mock('@/lib/agent-mission-control/langgraph-explorer', () => ({
  listAssistants: vi.fn(async () => serverAssistants),
}))

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (_method: string, path: string) => {
    const table = path.split('?')[0]
    if (table === 'copilots') return copilotRows
    if (table === 'projects') return projectRows
    throw new Error(`unexpected pgrest read in test: ${path}`)
  }),
}))

import { reconcileAssistants } from '@/lib/agent-mission-control/reconcile-assistants'

// ---------------------------------------------------------------------------
// Fixture builders — plain rows, exactly the columns the module selects.
// ---------------------------------------------------------------------------

function copilot(overrides: Partial<CopilotRow> = {}): CopilotRow {
  return {
    id: 'copilot-test',
    name: 'Test Copilot',
    assistant_id: null,
    runtime: 'langgraph',
    project_id: null,
    ...overrides,
  }
}

/** A copilot correctly wired to its own canonical v5 assistant on the server. */
function healthyLanggraphCopilot(id: string): { row: CopilotRow; server: ServerAssistant } {
  const assistantId = assistantIdForCopilot(id)
  return {
    row: copilot({ id, assistant_id: assistantId, runtime: 'langgraph' }),
    server: { assistantId, name: id, graphId: AGENT_BUILDER_GRAPH_ID },
  }
}

afterEach(() => {
  serverAssistants = []
  copilotRows = []
  projectRows = []
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Baseline — a fully reconciled world classifies nothing.
// ---------------------------------------------------------------------------

describe('reconcileAssistants — clean baseline', () => {
  it('a copilot on its canonical v5 assistant yields four EMPTY classes', async () => {
    const { row, server } = healthyLanggraphCopilot('copilot-atlas')
    copilotRows = [row]
    serverAssistants = [server]

    const report = await reconcileAssistants()
    expect(report.stale).toEqual([])
    expect(report.orphan).toEqual([])
    expect(report.driftV5).toEqual([])
    expect(report.inertPhantom).toEqual([])
  })

  it('a copilot with NO assistant_id (never provisioned) is in no class at all', async () => {
    copilotRows = [copilot({ id: 'copilot-fresh', assistant_id: null })]
    serverAssistants = []

    const report = await reconcileAssistants()
    expect(report.stale).toEqual([])
    expect(report.orphan).toEqual([])
    expect(report.driftV5).toEqual([])
    expect(report.inertPhantom).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The four classes, each in isolation.
// ---------------------------------------------------------------------------

describe('reconcileAssistants — the four divergence classes', () => {
  it('STALE — DB records an assistant_id absent from the server', async () => {
    // The stored id IS the canonical v5 id (so it is NOT drift) but the server
    // does not host it → the DB points at a deleted / never-created assistant.
    const id = 'copilot-stale'
    const assistantId = assistantIdForCopilot(id)
    copilotRows = [copilot({ id, assistant_id: assistantId, runtime: 'langgraph' })]
    serverAssistants = [] // server has nothing

    const report = await reconcileAssistants()
    expect(report.stale).toHaveLength(1)
    expect(report.stale[0]?.copilotId).toBe(id)
    expect(report.stale[0]?.assistantId).toBe(assistantId)
    // Not drift (id is canonical), not phantom (runtime IS langgraph).
    expect(report.driftV5).toEqual([])
    expect(report.inertPhantom).toEqual([])
    expect(report.orphan).toEqual([])
  })

  it('ORPHAN — a server assistant on OUR graph that no DB row claims', async () => {
    copilotRows = [] // no DB row claims anything
    projectRows = []
    serverAssistants = [
      { assistantId: 'srv-orphan-1', name: 'Ghost', graphId: AGENT_BUILDER_GRAPH_ID },
    ]

    const report = await reconcileAssistants()
    expect(report.orphan).toHaveLength(1)
    expect(report.orphan[0]?.assistantId).toBe('srv-orphan-1')
    expect(report.orphan[0]?.graphId).toBe(AGENT_BUILDER_GRAPH_ID)
    expect(report.stale).toEqual([])
  })

  it('ORPHAN excludes assistants on OTHER graphs (not ours to reconcile)', async () => {
    copilotRows = []
    projectRows = []
    serverAssistants = [
      { assistantId: 'srv-other-graph', name: 'Elsewhere', graphId: 'some_other_graph' },
    ]

    const report = await reconcileAssistants()
    expect(report.orphan).toEqual([])
  })

  it('ORPHAN excludes a server id claimed by a PROJECT row (not just copilots)', async () => {
    copilotRows = []
    projectRows = [{ id: 'proj-1', name: 'P1', assistant_id: 'srv-claimed-by-project' }]
    serverAssistants = [
      { assistantId: 'srv-claimed-by-project', name: 'ProjAssistant', graphId: AGENT_BUILDER_GRAPH_ID },
    ]

    const report = await reconcileAssistants()
    expect(report.orphan).toEqual([])
  })

  it('DRIFTV5 — stored id ≠ the deterministic v5 id for this copilot', async () => {
    const id = 'copilot-drift'
    const wrongId = 'legacy-manual-assistant-id'
    const expected = assistantIdForCopilot(id)
    expect(wrongId).not.toBe(expected)
    // Put the (wrong) id on the server too, so drift is isolated from stale.
    copilotRows = [copilot({ id, assistant_id: wrongId, runtime: 'langgraph' })]
    serverAssistants = [{ assistantId: wrongId, name: id, graphId: AGENT_BUILDER_GRAPH_ID }]

    const report = await reconcileAssistants()
    expect(report.driftV5).toHaveLength(1)
    expect(report.driftV5[0]?.copilotId).toBe(id)
    expect(report.driftV5[0]?.assistantId).toBe(wrongId)
    expect(report.driftV5[0]?.expectedAssistantId).toBe(expected)
    // On the server → not stale. Runtime langgraph → not phantom.
    expect(report.stale).toEqual([])
    expect(report.inertPhantom).toEqual([])
  })

  it('INERTPHANTOM — a non-langgraph copilot still carrying an assistant_id', async () => {
    // A fin-* copilot on the direct model-router path: runtime is openai-assistants
    // but it still drags a (canonical, present) assistant_id — dead metadata.
    const id = 'copilot-fin-tva'
    const assistantId = assistantIdForCopilot(id)
    copilotRows = [copilot({ id, assistant_id: assistantId, runtime: 'openai-assistants' })]
    serverAssistants = [{ assistantId, name: id, graphId: AGENT_BUILDER_GRAPH_ID }]

    const report = await reconcileAssistants()
    expect(report.inertPhantom).toHaveLength(1)
    expect(report.inertPhantom[0]?.copilotId).toBe(id)
    expect(report.inertPhantom[0]?.runtime).not.toBe('langgraph')
    expect(report.inertPhantom[0]?.assistantId).toBe(assistantId)
    // id is canonical AND present on server → neither drift nor stale.
    expect(report.driftV5).toEqual([])
    expect(report.stale).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// The classes are INDEPENDENT facts, not a partition — a single copilot can
// qualify for several at once.
// ---------------------------------------------------------------------------

describe('reconcileAssistants — classes are independent, not a partition', () => {
  it('a non-langgraph copilot with a drifted, absent id is stale + drift + phantom', async () => {
    const id = 'copilot-fin-paie'
    const wrongId = 'legacy-inert-id'
    const expected = assistantIdForCopilot(id)
    expect(wrongId).not.toBe(expected)
    copilotRows = [copilot({ id, assistant_id: wrongId, runtime: 'openai-assistants' })]
    serverAssistants = [] // absent → stale

    const report = await reconcileAssistants()
    expect(report.stale.map((s) => s.copilotId)).toContain(id) // absent from server
    expect(report.driftV5.map((d) => d.copilotId)).toContain(id) // wrong id
    expect(report.inertPhantom.map((p) => p.copilotId)).toContain(id) // non-langgraph
    // Same copilot instance surfaced in three classes.
    expect(report.stale[0]?.assistantId).toBe(wrongId)
    expect(report.driftV5[0]?.expectedAssistantId).toBe(expected)
  })

  it('classifies a mixed roster into exactly the right buckets', async () => {
    const healthy = healthyLanggraphCopilot('copilot-vector')
    const staleId = assistantIdForCopilot('copilot-sentinel')
    const phantomId = assistantIdForCopilot('copilot-fin-tva')

    copilotRows = [
      healthy.row,
      copilot({ id: 'copilot-sentinel', assistant_id: staleId, runtime: 'langgraph' }), // stale
      copilot({ id: 'copilot-fin-tva', assistant_id: phantomId, runtime: 'openai-assistants' }), // phantom
    ]
    serverAssistants = [
      healthy.server,
      { assistantId: phantomId, name: 'fin-tva', graphId: AGENT_BUILDER_GRAPH_ID }, // present → phantom only
      { assistantId: 'srv-orphan', name: 'Ghost', graphId: AGENT_BUILDER_GRAPH_ID }, // orphan
    ]

    const report = await reconcileAssistants()
    expect(report.stale.map((s) => s.copilotId)).toEqual(['copilot-sentinel'])
    expect(report.orphan.map((o) => o.assistantId)).toEqual(['srv-orphan'])
    expect(report.inertPhantom.map((p) => p.copilotId)).toEqual(['copilot-fin-tva'])
    // healthy copilot appears in NO class.
    const allTouched = [
      ...report.stale.map((r) => r.copilotId),
      ...report.driftV5.map((r) => r.copilotId),
      ...report.inertPhantom.map((r) => r.copilotId),
    ]
    expect(allTouched).not.toContain('copilot-vector')
  })
})
