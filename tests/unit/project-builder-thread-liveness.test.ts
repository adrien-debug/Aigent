/**
 * Unit tests for the thread-liveness guard in
 * src/lib/agent-mission-control/project-builder-conversation.ts,
 * startProjectBuilderDraftMaterialization.
 *
 * The `langgraphjs dev` Agent Server keeps threads IN MEMORY and wipes them on
 * restart, while the DB row still carries the old `langgraph_thread_id`. Before
 * this fix, the guard trusted that stored id blindly and threw "already in
 * progress" forever once the thread was gone — the same hallucination pattern
 * resolve-run-assistant.ts already closed for assistants, applied here to
 * threads. Proves the two branches:
 *  - a LIVE thread (client.threads.get resolves) → still throws "already in
 *    progress" and does NOT clear the DB thread id.
 *  - a DEAD thread (client.threads.get rejects with a 404-shaped error) →
 *    clears langgraph_thread_id in DB and proceeds to start a fresh
 *    materialization instead of throwing.
 *  - a genuine transport failure (non-404 error, e.g. the Agent Server itself
 *    unreachable) → propagates the error and does NOT clear the DB thread id
 *    (we don't know the thread's real state, so we don't guess).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const threadsGet = vi.fn()
vi.mock('@/lib/agent-mission-control/langgraph-client', () => ({
  agentServerClient: () => ({ threads: { get: threadsGet } }),
}))

const pgrestMock = vi.fn()
vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (...args: unknown[]) => pgrestMock(...args),
}))

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async () => ({ id: 'proj-1', repoFullName: undefined })),
}))

vi.mock('@/lib/agent-mission-control/repo-scan', () => ({
  scanProjectRepo: vi.fn(),
  repoScanToContext: vi.fn(),
}))

vi.mock('@/lib/agent-mission-control/agent-builder-run', () => ({
  startAgentBuilderRun: vi.fn(async () => ({ runId: 'thread-new' })),
  resumeAgentBuilderRun: vi.fn(),
  draftToCreateInput: vi.fn(),
}))

vi.mock('@/lib/agent-mission-control/authoring-writes', () => ({
  createCopilotFromManifest: vi.fn(),
  deleteCopilotCascade: vi.fn(),
  setCopilotAssistantId: vi.fn(),
}))

vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  ensureCopilotAssistant: vi.fn(),
  deleteCopilotAssistant: vi.fn(),
}))

import { startAgentBuilderRun } from '@/lib/agent-mission-control/agent-builder-run'
import { startProjectBuilderDraftMaterialization } from '@/lib/agent-mission-control/project-builder-conversation'

const READY_PREVIEW = {
  name: 'Design Sentinel',
  role: 'watches the design system',
  readyForApproval: true,
}

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'conv-1',
    project_id: 'proj-1',
    status: 'active',
    langgraph_thread_id: 'thread-stale',
    latest_preview: READY_PREVIEW,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  threadsGet.mockReset()
  pgrestMock.mockReset()
  vi.mocked(startAgentBuilderRun).mockClear()
  pgrestMock.mockImplementation(async (method: string, path: string) => {
    if (method === 'GET' && path.startsWith('project_builder_conversations?')) return [conversationRow()]
    if (method === 'GET' && path.startsWith('copilots?')) return [{ id: 'builder-copilot-1' }]
    return []
  })
})

describe('startProjectBuilderDraftMaterialization — thread liveness guard', () => {
  it('throws "already in progress" and does NOT clear the DB thread id when the thread is still LIVE', async () => {
    threadsGet.mockResolvedValueOnce({ thread_id: 'thread-stale', status: 'busy' })

    await expect(startProjectBuilderDraftMaterialization('proj-1')).rejects.toThrow(
      'draft materialization already in progress'
    )

    expect(threadsGet).toHaveBeenCalledWith('thread-stale')
    expect(startAgentBuilderRun).not.toHaveBeenCalled()

    const clearedThreadId = pgrestMock.mock.calls.some(
      ([method, path, body]) =>
        method === 'PATCH' &&
        typeof path === 'string' &&
        path.startsWith('project_builder_conversations?') &&
        (body as Record<string, unknown> | undefined)?.langgraph_thread_id === null
    )
    expect(clearedThreadId).toBe(false)
  })

  it('clears the stale thread id and re-arms (starts a fresh run) when the thread is DEAD (404)', async () => {
    threadsGet.mockRejectedValueOnce({ status: 404, message: 'Thread not found' })

    const result = await startProjectBuilderDraftMaterialization('proj-1')

    expect(threadsGet).toHaveBeenCalledWith('thread-stale')
    expect(startAgentBuilderRun).toHaveBeenCalledTimes(1)
    expect(result.runState.runId).toBe('thread-new')

    const clearCall = pgrestMock.mock.calls.find(
      ([method, path, body]) =>
        method === 'PATCH' &&
        typeof path === 'string' &&
        path.startsWith('project_builder_conversations?') &&
        (body as Record<string, unknown> | undefined)?.langgraph_thread_id === null
    )
    expect(clearCall).toBeDefined()

    // Final PATCH re-arms with the freshly started run's thread id.
    const finalPatch = pgrestMock.mock.calls.find(
      ([method, path, body]) =>
        method === 'PATCH' &&
        typeof path === 'string' &&
        path.startsWith('project_builder_conversations?') &&
        (body as Record<string, unknown> | undefined)?.langgraph_thread_id === 'thread-new'
    )
    expect(finalPatch).toBeDefined()
  })

  it('propagates a non-404 transport error and does NOT clear the DB thread id (prudent on a real outage)', async () => {
    threadsGet.mockRejectedValueOnce({ status: 500, message: 'Agent Server unreachable' })

    await expect(startProjectBuilderDraftMaterialization('proj-1')).rejects.toMatchObject({
      status: 500,
    })

    expect(startAgentBuilderRun).not.toHaveBeenCalled()
    const clearedThreadId = pgrestMock.mock.calls.some(
      ([method, path, body]) =>
        method === 'PATCH' &&
        typeof path === 'string' &&
        path.startsWith('project_builder_conversations?') &&
        (body as Record<string, unknown> | undefined)?.langgraph_thread_id === null
    )
    expect(clearedThreadId).toBe(false)
  })
})
