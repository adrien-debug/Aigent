import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  GET as GET_INSTALLATIONS,
  POST as POST_INSTALLATIONS,
} from '@/app/api/agent-ops/projects/[id]/consumer-installations/route'
import { POST as POST_REVOKE } from '@/app/api/agent-ops/projects/[id]/consumer-installations/[installationId]/revoke/route'

const getProject = vi.fn()
const getCopilot = vi.fn()
const getVersionsForCopilot = vi.fn()
const getDeliveryEventById = vi.fn()
const createConsumerInstallation = vi.fn()
const listConsumerInstallations = vi.fn()
const getConsumerInstallation = vi.fn()
const revokeConsumerInstallation = vi.fn()

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: (...args: unknown[]) => getProject(...args),
  getCopilot: (...args: unknown[]) => getCopilot(...args),
  getVersionsForCopilot: (...args: unknown[]) => getVersionsForCopilot(...args),
}))

vi.mock('@/lib/agent-mission-control/delivery-events-store', () => ({
  getDeliveryEventById: (...args: unknown[]) => getDeliveryEventById(...args),
}))

vi.mock('@/lib/agent-mission-control/consumer-installations', () => ({
  createConsumerInstallation: (...args: unknown[]) => createConsumerInstallation(...args),
  listConsumerInstallations: (...args: unknown[]) => listConsumerInstallations(...args),
  getConsumerInstallation: (...args: unknown[]) => getConsumerInstallation(...args),
  revokeConsumerInstallation: (...args: unknown[]) => revokeConsumerInstallation(...args),
}))

describe('consumer-installations routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getProject.mockResolvedValue({ id: 'proj-1' })
    getCopilot.mockResolvedValue({ id: 'cop-1', projectId: 'proj-1' })
    getVersionsForCopilot.mockResolvedValue([{ id: 'v-1' }])
    getDeliveryEventById.mockResolvedValue({
      id: 'd-1',
      copilotId: 'cop-1',
      projectId: 'proj-1',
      versionId: 'v-1',
      status: 'delivered',
    })
    createConsumerInstallation.mockResolvedValue({
      installationId: 'inst-proj-1-cop-1-development-123',
      token: 'inst_xxxxx',
      tokenPrefix: 'inst_x',
    })
    listConsumerInstallations.mockResolvedValue([{ id: 'inst-1' }])
    getConsumerInstallation.mockResolvedValue({ id: 'inst-1', projectId: 'proj-1', status: 'active' })
    revokeConsumerInstallation.mockResolvedValue({ id: 'inst-1', projectId: 'proj-1', status: 'revoked' })
  })

  it('creates installation and returns one-time token', async () => {
    const res = await POST_INSTALLATIONS(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copilotId: 'cop-1',
          versionId: 'v-1',
          deliveryEventId: 'd-1',
          environment: 'development',
          label: 'dev consumer',
        }),
      }),
      { params: Promise.resolve({ id: 'proj-1' }) }
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.token).toBe('inst_xxxxx')
    expect(createConsumerInstallation).toHaveBeenCalledTimes(1)
  })

  it('rejects mismatched delivery event', async () => {
    getDeliveryEventById.mockResolvedValue({
      id: 'd-1',
      copilotId: 'cop-1',
      projectId: 'proj-1',
      versionId: 'v-OTHER',
      status: 'delivered',
    })
    const res = await POST_INSTALLATIONS(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copilotId: 'cop-1',
          versionId: 'v-1',
          deliveryEventId: 'd-1',
          environment: 'development',
        }),
      }),
      { params: Promise.resolve({ id: 'proj-1' }) }
    )
    expect(res.status).toBe(422)
  })

  it('rejects non-delivered delivery event', async () => {
    getDeliveryEventById.mockResolvedValue({
      id: 'd-1',
      copilotId: 'cop-1',
      projectId: 'proj-1',
      versionId: 'v-1',
      status: 'failed',
    })
    const res = await POST_INSTALLATIONS(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          copilotId: 'cop-1',
          versionId: 'v-1',
          deliveryEventId: 'd-1',
          environment: 'development',
        }),
      }),
      { params: Promise.resolve({ id: 'proj-1' }) }
    )
    expect(res.status).toBe(422)
  })

  it('lists project installations', async () => {
    const res = await GET_INSTALLATIONS(new Request('http://x?copilotId=cop-1'), {
      params: Promise.resolve({ id: 'proj-1' }),
    })
    expect(res.status).toBe(200)
    expect(listConsumerInstallations).toHaveBeenCalledWith('proj-1', 'cop-1')
  })

  it('revokes active installation', async () => {
    const res = await POST_REVOKE(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'rotation test' }),
      }),
      { params: Promise.resolve({ id: 'proj-1', installationId: 'inst-1' }) }
    )
    expect(res.status).toBe(200)
    expect(revokeConsumerInstallation).toHaveBeenCalledWith('inst-1', 'rotation test')
  })

  it('rejects revoke when installation is already revoked', async () => {
    getConsumerInstallation.mockResolvedValue({
      id: 'inst-1',
      projectId: 'proj-1',
      status: 'revoked',
    })
    const res = await POST_REVOKE(
      new Request('http://x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'rotation test' }),
      }),
      { params: Promise.resolve({ id: 'proj-1', installationId: 'inst-1' }) }
    )
    expect(res.status).toBe(409)
  })
})
