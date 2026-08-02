import { describe, expect, it, vi } from 'vitest'

const pgrest = vi.fn()

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: (...args: unknown[]) => pgrest(...args),
}))

import { readConsumerActivation } from '@/lib/agent-mission-control/consumer-activation'

describe('readConsumerActivation', () => {
  it('queries only authenticated + version-verified rows', async () => {
    pgrest.mockResolvedValueOnce([
      {
        event_type: 'consumer.run_completed',
        received_at: new Date().toISOString(),
        installation_id: 'inst-1',
        version_id: 'v-1',
      },
    ])

    const read = await readConsumerActivation('cop-1', { delivered: true })
    expect(read.activeInConsumer === true || read.activeInConsumer === 'unknown').toBe(true)

    expect(pgrest).toHaveBeenCalledTimes(1)
    const [method, path] = pgrest.mock.calls[0] as [string, string]
    expect(method).toBe('GET')
    expect(path).toContain('installation_id=not.is.null')
    expect(path).toContain('version_verified=eq.true')
  })

  it('fails closed on backend error (throws, never fabricates unknown)', async () => {
    pgrest.mockRejectedValueOnce(new Error('backend unavailable'))
    await expect(readConsumerActivation('cop-1', { delivered: true })).rejects.toThrow(
      'backend unavailable'
    )
  })
})
