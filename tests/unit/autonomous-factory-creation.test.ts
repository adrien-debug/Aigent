/**
 * AIGENT-AUTONOMOUS-FACTORY-001 — compensable creation (createCopilotFromManifest).
 *
 * Proves the "no silent partial creation" contract at the DB write layer:
 *   #1  a full creation issues the four inserts in FK-safe order.
 *   #5  a failure AFTER the parent row compensates by cascade-deleting it, and
 *       surfaces a PartialCreationError (never a silent orphan) only when the
 *       compensating delete ALSO fails.
 * Offline: pgrest + the assistant module are mocked; no backend, no provider call.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const calls: Array<{ method: string; table: string }> = []
  const config: { failOn?: { method: string; table: string }; failDelete?: boolean } = {}
  async function pgrest(method: string, path: string, _body?: unknown): Promise<unknown> {
    const table = path.split('?')[0]
    calls.push({ method, table })
    if (config.failDelete && method === 'DELETE' && table === 'copilots') throw new Error('compensating delete failed')
    if (config.failOn && config.failOn.method === method && config.failOn.table === table) throw new Error(`fail ${method} ${table}`)
    return []
  }
  async function pgrestUpsert(table: string, _body?: unknown): Promise<unknown> {
    calls.push({ method: 'UPSERT', table })
    if (config.failOn && config.failOn.method === 'UPSERT' && config.failOn.table === table) {
      throw new Error(`fail UPSERT ${table}`)
    }
    return []
  }
  return { calls, config, pgrest, pgrestUpsert }
})

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (m: string, p: string, b?: unknown) => h.pgrest(m, p, b),
  pgrestUpsert: (t: string, b?: unknown) => h.pgrestUpsert(t, b),
  requireBackend: () => ({ base: 'https://x/rest', key: 'k' }),
}))
vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  assistantIdForCopilot: (id: string) => `asst-${id}`,
  deleteCopilotAssistant: vi.fn(async () => {}),
  deleteProjectAssistant: vi.fn(async () => {}),
}))

import { createCopilotFromManifest, PartialCreationError } from '@/lib/agent-mission-control/authoring-writes'
import type { CreateCopilotInput } from '@/lib/agent-mission-control/authoring-types'

function input(): CreateCopilotInput {
  return {
    name: 'Test Agent',
    slug: 'test-agent',
    description: 'a test',
    runtime: 'langgraph',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'ops',
    tags: [],
    projectId: null,
    targetProjectIds: [],
    manifest: {
      systemPromptSummary: 'read things',
      allowedRoutes: [],
      forbiddenActions: [],
      confirmationPolicy: 'risky-only',
      alwaysConfirmActions: [],
      outputContract: { format: 'markdown', schemaName: null, invariants: [] },
      proposedTools: [
        { name: 'read_summary', description: 'reads a summary', provider: 'internal', riskLevel: 'low', requiresConfirmation: false, mutates: false },
      ],
      skills: [],
      maxStepsPerRun: 10,
      maxCostPerRunUsd: 1,
    },
  } as CreateCopilotInput
}

beforeEach(() => {
  h.calls.length = 0
  delete h.config.failOn
  delete h.config.failDelete
})

describe('createCopilotFromManifest — full creation (#1)', () => {
  it('inserts copilots → manifests → tools → manifest.tool_ids → copilot_versions, no delete', async () => {
    const id = await createCopilotFromManifest(input())
    expect(id).toMatch(/^copilot-/)
    const seq = h.calls.map((c) => `${c.method} ${c.table}`)
    expect(seq).toEqual([
      'POST copilots',
      'POST manifests',
      'UPSERT tool_definitions',
      'POST tools',
      'PATCH manifests',
      'POST copilot_versions',
    ])
    expect(seq.some((s) => s.startsWith('DELETE'))).toBe(false)
  })
})

describe('createCopilotFromManifest — compensation (#5)', () => {
  it('compensates by deleting the parent row when a later insert fails, and rethrows the cause', async () => {
    h.config.failOn = { method: 'POST', table: 'manifests' }
    await expect(createCopilotFromManifest(input())).rejects.toThrow('fail POST manifests')
    const seq = h.calls.map((c) => `${c.method} ${c.table}`)
    expect(seq).toEqual(['POST copilots', 'POST manifests', 'DELETE copilots'])
  })

  it('does NOT throw PartialCreationError when compensation succeeds', async () => {
    h.config.failOn = { method: 'POST', table: 'copilot_versions' }
    const err = await createCopilotFromManifest(input()).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err).not.toBeInstanceOf(PartialCreationError)
    expect(h.calls.some((c) => c.method === 'DELETE' && c.table === 'copilots')).toBe(true)
  })

  it('raises PartialCreationError (naming the orphan) only when the compensating delete ALSO fails', async () => {
    h.config.failOn = { method: 'POST', table: 'manifests' }
    h.config.failDelete = true
    const err = await createCopilotFromManifest(input()).catch((e) => e)
    expect(err).toBeInstanceOf(PartialCreationError)
    expect((err as PartialCreationError).orphanCopilotId).toMatch(/^copilot-/)
    expect((err as PartialCreationError).failedStep).toBe('manifests')
  })

  it('writes NOTHING to undo when the very first insert (copilots) fails', async () => {
    h.config.failOn = { method: 'POST', table: 'copilots' }
    await expect(createCopilotFromManifest(input())).rejects.toThrow('fail POST copilots')
    expect(h.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
})
