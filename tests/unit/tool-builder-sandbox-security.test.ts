import { describe, expect, it } from 'vitest'

import { runLocalDeterministicSandbox, type LocalDeterministicSandbox } from '@/lib/agent-mission-control/tool-builder/sandbox'

describe('Tool Builder sandbox security guards', () => {
  it('returns unavailable when capability is not allowlisted', async () => {
    const result = await runLocalDeterministicSandbox({
      id: 'bad-capability',
      timeoutMs: 100,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec', 'network-write'],
      execute: (value: string) => value,
      cases: [{ name: 'one', input: 'ok', expected: 'ok' }],
    })
    expect(result.status).toBe('unavailable')
    expect(result.evidence.ran).toBe(false)
  })

  it('fails when a case exceeds input limit', async () => {
    const result = await runLocalDeterministicSandbox({
      id: 'input-limit',
      timeoutMs: 100,
      maxCases: 2,
      maxInputBytes: 2,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      execute: (value: string) => value,
      cases: [{ name: 'too-big', input: 'abcd', expected: 'abcd' }],
    })
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toContain('input too large')
  })

  it('fails when execution exceeds timeout', async () => {
    const slowSandbox: LocalDeterministicSandbox<number, number> = {
      id: 'timeout',
      timeoutMs: 20,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      execute: async (value) => {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return value
      },
      cases: [{ name: 'slow', input: 1, expected: 1 }],
    }

    const result = await runLocalDeterministicSandbox(slowSandbox)
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toContain('timeout')
  })

  it('executes with an isolated empty env context', async () => {
    const result = await runLocalDeterministicSandbox({
      id: 'env-isolation',
      timeoutMs: 100,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      execute: (_value: string, context) => JSON.stringify(context.env),
      cases: [{ name: 'empty-env', input: 'x', expected: '{}' }],
    })
    expect(result.status).toBe('certified')
    expect(result.evidence.failed).toBe(0)
  })
})
