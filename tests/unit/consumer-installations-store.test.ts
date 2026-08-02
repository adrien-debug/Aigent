import { describe, expect, it, vi } from 'vitest'

const pgrest = vi.fn()

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (...args: unknown[]) => pgrest(...args),
}))

import {
  createConsumerInstallation,
  hashInstallationToken,
  listConsumerInstallations,
} from '@/lib/agent-mission-control/consumer-installations'

describe('consumer-installations store', () => {
  it('persists hash-only token material on creation', async () => {
    pgrest.mockResolvedValueOnce([])
    const created = await createConsumerInstallation({
      id: 'inst-production-abc',
      projectId: 'proj-1',
      copilotId: 'cop-1',
      versionId: 'v-1',
      deliveryEventId: 'd-1',
      environment: 'production',
      label: 'acme-prod',
    })

    expect(created.token.length).toBeGreaterThan(10)
    expect(created.tokenPrefix.length).toBeGreaterThan(0)
    expect(created.token.startsWith(created.tokenPrefix)).toBe(true)

    expect(pgrest).toHaveBeenCalledTimes(1)
    const [, , body] = pgrest.mock.calls[0] as [string, string, Record<string, unknown>]
    expect(body.id).toBe('inst-production-abc')
    expect(body.token_hash).toBe(hashInstallationToken(created.token))
    expect(body.token_prefix).toBe(created.tokenPrefix)
    expect(body.token).toBeUndefined()
  })

  it('listing never exposes token hash or clear token', async () => {
    pgrest.mockResolvedValueOnce([
      {
        id: 'inst-1',
        project_id: 'proj-1',
        copilot_id: 'cop-1',
        environment: 'production',
        label: 'acme',
        status: 'active',
        last_seen_at: null,
        last_version_loaded: null,
        last_version_loaded_at: null,
        version_id: 'v-1',
        delivery_event_id: 'd-1',
        revoked_reason: null,
        token_hash: 'a'.repeat(64),
      },
    ])
    const rows = await listConsumerInstallations('proj-1')
    expect(rows).toHaveLength(1)
    expect(rows[0]).not.toHaveProperty('tokenHash')
    expect(rows[0]).not.toHaveProperty('token')
  })
})
