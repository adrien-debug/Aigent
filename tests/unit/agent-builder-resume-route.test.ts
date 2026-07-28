import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  AGENT_BUILDER_RUN_ID_RE,
  parseAgentBuilderResumeRequest,
} from '@/lib/agent-mission-control/agent-builder-resume-route'

describe('agent-builder-resume-route', () => {
  it('accepts a valid resume body', async () => {
    const runId = '0ce125fe-8e03-46ea-8504-9b28f1ba47f5'
    const result = await parseAgentBuilderResumeRequest(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ runId, approved: true }),
      })
    )
    expect(result).toEqual({ ok: true, runId, approved: true })
  })

  it('rejects invalid JSON', async () => {
    const result = await parseAgentBuilderResumeRequest(
      new Request('http://localhost/api', { method: 'POST', body: '{' })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('rejects non-uuid runId', async () => {
    const result = await parseAgentBuilderResumeRequest(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ runId: '../threads/evil', approved: false }),
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('rejects non-boolean approved', async () => {
    const runId = '972e2025-8a9e-43f8-8725-b71f897e277f'
    const result = await parseAgentBuilderResumeRequest(
      new Request('http://localhost/api', {
        method: 'POST',
        body: JSON.stringify({ runId, approved: 'yes' }),
      })
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(400)
  })

  it('documents the runId guard regex', () => {
    expect(AGENT_BUILDER_RUN_ID_RE.test('d330df9b-7450-42ce-b23d-a72af2a6b5d6')).toBe(true)
    expect(AGENT_BUILDER_RUN_ID_RE.test('not-a-uuid')).toBe(false)
  })
})
