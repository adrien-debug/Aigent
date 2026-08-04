/**
 * AIGENT-FACTORY-READY-001 — the LIVE shadow run agent (real LangGraph path).
 *
 * Proves the write-safety classification WITHOUT any real LLM/Agent-Server call:
 * the live adapter + candidate-assistant seam are mocked, and the ShadowToolGate
 * is driven directly. A mutating tool the candidate attempted (interrupted at the
 * confirmation gate → status !== 'completed') is recorded as would-mutate and NOT
 * executed; a read tool that completed is executed. Cleanup tears the assistant down.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const state = { toolCalls: [] as Array<{ toolName: string; status: string }>, reply: 'ok', cost: 0.01 }
  const executeAgent = vi.fn(async (_req: unknown) => ({
    toolCalls: state.toolCalls,
    reply: state.reply,
    pausedForConfirmation: false,
    pendingToolName: null,
    costUsd: state.cost,
  }))
  const ensureCandidateAssistant = vi.fn(async () => 'asst-candidate')
  const deleteCandidateAssistant = vi.fn(async () => true)
  const pgrest = vi.fn(async (_m: string, path: string) => {
    if (path.startsWith('copilot_versions')) return [{ copilot_id: 'copilot-x', model: 'gpt-5.4', model_provider: 'openai', manifest_id: 'manifest-x' }]
    if (path.startsWith('copilots')) return [{ project_id: null }]
    if (path.startsWith('manifests')) return [{ system_prompt_summary: 'do things', max_steps_per_run: 5 }]
    return []
  })
  return { state, executeAgent, ensureCandidateAssistant, deleteCandidateAssistant, pgrest }
})

vi.mock('@/lib/agent-mission-control/evidence/live-adapter', () => ({
  liveEvidenceAdapter: { mode: 'live', label: 'live', executeAgent: h.executeAgent, judge: vi.fn() },
}))
vi.mock('@/lib/agent-mission-control/langgraph-assistants', () => ({
  ensureCandidateAssistant: h.ensureCandidateAssistant,
  deleteCandidateAssistant: h.deleteCandidateAssistant,
}))
vi.mock('@/lib/agent-mission-control/postgrest', () => ({ pgrest: (m: string, p: string) => h.pgrest(m, p) }))

import { makeLiveShadowAgent } from '@/lib/agent-mission-control/shadow-live'

/** A gate driven directly: only `write_ledger` mutates. */
const gate = { check: (name: string) => (name === 'write_ledger' ? { allow: false, wouldMutate: true } : { allow: true, wouldMutate: false }) }

beforeEach(() => {
  h.state.toolCalls = []
  h.state.reply = 'ok'
  vi.clearAllMocks()
})

describe('makeLiveShadowAgent (real LangGraph path)', () => {
  it('provisions the ephemeral candidate assistant and runs it via the live adapter', async () => {
    const { runAgent } = await makeLiveShadowAgent('version-x')
    expect(h.ensureCandidateAssistant).toHaveBeenCalledWith('version-x')
    h.state.toolCalls = [{ toolName: 'read_repo_file', status: 'ok' }]
    const r = await runAgent('summarize the readme', gate)
    expect(h.executeAgent).toHaveBeenCalledTimes(1)
    expect(h.executeAgent.mock.calls[0][0]).toMatchObject({ runtime: 'langgraph', assistantId: 'asst-candidate', versionId: 'version-x' })
    expect(r.ok).toBe(true)
    expect(r.output).toBe('ok')
  })

  it('classifies a mutating tool as would-mutate + NOT executed, a read tool as executed', async () => {
    const { runAgent } = await makeLiveShadowAgent('version-x')
    h.state.toolCalls = [
      { toolName: 'read_repo_file', status: 'ok' },
      { toolName: 'write_ledger', status: 'blocked' }, // interrupted at confirmation
    ]
    const r = await runAgent('do a thing', gate)
    expect(r.toolAttempts).toEqual([
      { name: 'read_repo_file', wouldMutate: false, executed: true },
      { name: 'write_ledger', wouldMutate: true, executed: false },
    ])
  })

  it('surfaces infrastructure unavailability instead of grading it as candidate failure', async () => {
    const { runAgent } = await makeLiveShadowAgent('version-x')
    h.executeAgent.mockRejectedValueOnce(new Error('agent server down'))
    await expect(runAgent('x', gate)).rejects.toThrow(/shadow runtime unavailable.*agent server down/)
  })

  it('cleanup tears down the ephemeral assistant', async () => {
    const { cleanup } = await makeLiveShadowAgent('version-x')
    await cleanup()
    expect(h.deleteCandidateAssistant).toHaveBeenCalledWith('version-x')
  })
})
