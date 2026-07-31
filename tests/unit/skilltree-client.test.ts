import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildSkillTreeTrack } from '@/lib/agent-mission-control/agent-skills-export'
import {
  publishSkillTreeTrack,
  SkillTreeClientError,
  type SkillTreeConnection,
} from '@/lib/agent-mission-control/skilltree-client'

const connection: SkillTreeConnection = {
  treeName: 'Test Tree',
  slug: 'test-tree',
  endpoint: 'https://example.test/api/import',
  token: 'test-token',
}

const track = buildSkillTreeTrack({
  agentName: 'Test Agent',
  agentSlug: 'test-agent',
  agentDescription: 'Test agent.',
  manifestVersion: '1.0.0',
  confirmationPolicy: 'risky-only',
  forbiddenActions: [],
  skills: [{ label: 'Read facts', detail: 'Reads measured facts.' }],
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SkillTree client', () => {
  it('sends a merge payload and preserves private visibility', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, slug: 'test-tree', counts: { added: 1, updated: 0, deleted: 0 } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await publishSkillTreeTrack(connection, track)

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string) as {
      mode: string
      tracks: Array<{ skills: Array<{ isPublic: boolean }> }>
    }
    expect(body.mode).toBe('merge')
    expect(body.tracks[0].skills[0].isPublic).toBe(false)
    expect(init.headers).toEqual({
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
    })
    expect(result).toMatchObject({ slug: 'test-tree', added: 1, updated: 0, deleted: 0 })
  })

  it('stops on 401 with the reconnect instruction', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })))

    await expect(publishSkillTreeTrack(connection, track)).rejects.toEqual(
      new SkillTreeClientError('Reconnect this Tree from SkillTree settings', 401)
    )
  })
})
