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
      executeSource: '(value) => value',
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
      executeSource: '(value) => value',
      cases: [{ name: 'too-big', input: 'abcd', expected: 'abcd' }],
    })
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toContain('input too large')
  })

  it('terminates an infinite loop on timeout', async () => {
    const infiniteLoopSandbox: LocalDeterministicSandbox<number, number> = {
      id: 'infinite-loop',
      timeoutMs: 50,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      executeSource: '() => { while (true) {} }',
      cases: [{ name: 'loop', input: 1, expected: 1 }],
    }

    const result = await runLocalDeterministicSandbox(infiniteLoopSandbox)
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toContain('timeout')
  })

  it('terminates a synchronous blocking executor without hanging main thread', async () => {
    const started = Date.now()
    const result = await runLocalDeterministicSandbox({
      id: 'sync-blocking',
      timeoutMs: 40,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      executeSource: '() => { const end = Date.now() + 5000; while (Date.now() < end) {} return 1 }',
      cases: [{ name: 'blocking', input: 1, expected: 1 }],
    })
    const elapsed = Date.now() - started
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toContain('timeout')
    expect(elapsed).toBeLessThan(1500)
  })

  it('prevents access to process/env/global from executor code', async () => {
    const result = await runLocalDeterministicSandbox({
      id: 'env-process-global-isolation',
      timeoutMs: 100,
      maxCases: 2,
      maxInputBytes: 1024,
      maxOutputBytes: 1024,
      capabilities: ['local-deterministic-exec'],
      executeSource: '() => ({ proc: process.env, glob: global, gproc: globalThis.process })',
      cases: [{ name: 'no-access', input: 'x', expected: null }],
    })
    expect(result.status).toBe('failed')
    expect(result.evidence.failed).toBe(1)
    expect(result.evidence.detail).toMatch(/process is not defined|Cannot read properties/)
  })
})
