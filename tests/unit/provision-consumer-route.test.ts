import { beforeEach, describe, expect, it, vi } from 'vitest'

import { GET, POST } from '@/app/api/agent-ops/projects/[id]/provision-consumer/route'

const getProject = vi.fn()
const getConsumerProvisionStatus = vi.fn()
const provisionConsumerIntake = vi.fn()

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: (...args: unknown[]) => getProject(...args),
}))

vi.mock('@/lib/agent-mission-control/github', () => ({
  getConsumerProvisionStatus: (...args: unknown[]) => getConsumerProvisionStatus(...args),
  provisionConsumerIntake: (...args: unknown[]) => provisionConsumerIntake(...args),
}))

describe('provision-consumer route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProject.mockResolvedValue({
      id: 'proj-x',
      slug: 'x',
      name: 'X',
      repoFullName: 'owner/repo',
    })
  })

  it('GET returns provision status', async () => {
    getConsumerProvisionStatus.mockResolvedValue({
      provisioned: true,
      version: '1.0.0',
      provisionedAt: '2026-07-19T00:00:00Z',
      projectKey: 'x',
    })
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: 'proj-x' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.provisioned).toBe(true)
    expect(body.version).toBe('1.0.0')
  })

  it('POST dry-runs by default', async () => {
    provisionConsumerIntake.mockResolvedValue({
      pushed: false,
      dryRun: true,
      mode: 'pull_request',
      branch: 'aigent/provision-x',
      files: ['aigent/consumer-ready.json'],
      message: 'dry-run',
    })
    const res = await POST(new Request('http://x', { method: 'POST', body: '{}' }), {
      params: Promise.resolve({ id: 'proj-x' }),
    })
    expect(res.status).toBe(200)
    expect(provisionConsumerIntake).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true, mode: 'pull_request' })
    )
  })

  it('POST confirm arms real provision', async () => {
    provisionConsumerIntake.mockResolvedValue({ pushed: true, dryRun: false, files: [], message: 'ok' })
    const res = await POST(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, deliveryMode: 'direct_commit' }),
      }),
      { params: Promise.resolve({ id: 'proj-x' }) }
    )
    expect(res.status).toBe(200)
    expect(provisionConsumerIntake).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, mode: 'direct_commit' })
    )
  })

  it('GET 422 when project has no repo', async () => {
    getProject.mockResolvedValue({ id: 'proj-x', repoFullName: null })
    const res = await GET(new Request('http://x'), { params: Promise.resolve({ id: 'proj-x' }) })
    expect(res.status).toBe(422)
  })
})
