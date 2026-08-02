/**
 * Unit tests for the delivery events store
 * (src/lib/agent-mission-control/delivery-events-store.ts). pgrest mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = { method: string; path: string; body?: unknown }
let calls: Call[]
let getResponse: unknown[]

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body })
    return method === 'GET' ? getResponse : undefined
  }),
}))

import { persistDeliveryEvent, getLatestDeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'

describe('persistDeliveryEvent', () => {
  beforeEach(() => {
    calls = []
    getResponse = []
  })

  it('7 — maps PR delivery fields into the row', async () => {
    await persistDeliveryEvent({
      id: 'delivery_1',
      copilotId: 'copilot-x',
      versionId: 'v-x',
      projectId: 'proj-x',
      mode: 'pull_request',
      targetRepo: 'owner/repo',
      targetBranch: 'main',
      deliveryBranch: 'agent/btc-abc123',
      commitSha: 'sha1',
      commitUrl: 'https://github.com/owner/repo/commit/sha1',
      prUrl: 'https://github.com/owner/repo/pull/7',
      prNumber: 7,
      status: 'delivered',
    })
    const body = calls[0].body as Record<string, unknown>
    expect(body.mode).toBe('pull_request')
    expect(body.version_id).toBe('v-x')
    expect(body.delivery_branch).toBe('agent/btc-abc123')
    expect(body.pr_number).toBe(7)
    expect(body.pr_url).toBe('https://github.com/owner/repo/pull/7')
    expect(body.status).toBe('delivered')
  })
})

describe('getLatestDeliveryEvent', () => {
  beforeEach(() => {
    calls = []
    getResponse = []
  })

  it('returns the newest event, ordered created_at desc limit 1', async () => {
    getResponse = [
      {
        id: 'delivery_2',
        version_id: 'v-2',
        mode: 'pull_request',
        target_repo: 'owner/repo',
        target_branch: 'main',
        delivery_branch: 'agent/btc-xyz',
        commit_sha: 's',
        commit_url: 'u',
        pr_url: 'https://github.com/owner/repo/pull/9',
        pr_number: 9,
        status: 'delivered',
        created_at: '2026-07-16T07:00:00Z',
      },
    ]
    const e = await getLatestDeliveryEvent('copilot-x')
    expect(e?.versionId).toBe('v-2')
    expect(e?.prNumber).toBe(9)
    expect(e?.deliveryBranch).toBe('agent/btc-xyz')
    const get = calls.find((c) => c.method === 'GET')!
    expect(get.path).toContain('order=created_at.desc')
    expect(get.path).toContain('limit=1')
  })

  it('null when no delivery yet', async () => {
    getResponse = []
    expect(await getLatestDeliveryEvent('copilot-x')).toBeNull()
  })
})
