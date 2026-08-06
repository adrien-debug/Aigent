/**
 * Unit tests for request-in-flight-guard.ts
 * (src/lib/agent-mission-control/request-in-flight-guard.ts).
 *
 * Pure, offline. Covers: basic pass-through, conflict detection for concurrent
 * calls, release-in-finally (so a thrown fn never leaves the key blocked), and
 * the isConflict() helper.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { isConflict, withInFlightGuard } from '@/lib/agent-mission-control/request-in-flight-guard'

describe('withInFlightGuard', () => {
  it('returns the fn() result when no concurrent call is in progress', async () => {
    const result = await withInFlightGuard('key-a', async () => 'hello')
    expect(result).toBe('hello')
  })

  it('returns { conflict: true } for a second concurrent call on the same key', async () => {
    // Start fn1 but never resolve it yet so key stays in-flight.
    let resolveFn1!: (v: string) => void
    const fn1Promise = new Promise<string>((res) => {
      resolveFn1 = res
    })

    const guard1 = withInFlightGuard('key-b', () => fn1Promise)

    // While fn1 is in-flight, a second call must be rejected immediately.
    const guard2 = await withInFlightGuard('key-b', async () => 'should not run')
    expect(isConflict(guard2)).toBe(true)

    // Resolve fn1 and make sure the first guard completes normally.
    resolveFn1('done')
    const result1 = await guard1
    expect(result1).toBe('done')
  })

  it('uses independent locks for different keys', async () => {
    let resolveA!: () => void
    const promiseA = new Promise<string>((res) => {
      resolveA = () => res('a')
    })

    const guardA = withInFlightGuard('key-c-alpha', () => promiseA)
    // key-c-beta is a different key — must NOT conflict.
    const guardB = await withInFlightGuard('key-c-beta', async () => 'b')
    expect(guardB).toBe('b')

    resolveA()
    await guardA
  })

  it('releases the lock after fn() completes so the next call succeeds', async () => {
    await withInFlightGuard('key-d', async () => 'first')
    // The first call finished — lock must be released.
    const second = await withInFlightGuard('key-d', async () => 'second')
    expect(second).toBe('second')
  })

  it('releases the lock even when fn() throws, so the next call succeeds', async () => {
    await expect(
      withInFlightGuard('key-e', async () => {
        throw new Error('boom')
      })
    ).rejects.toThrow('boom')

    // After the throw the key must be cleared.
    const after = await withInFlightGuard('key-e', async () => 'recovered')
    expect(after).toBe('recovered')
  })
})

describe('isConflict', () => {
  it('returns true for { conflict: true }', () => {
    expect(isConflict({ conflict: true })).toBe(true)
  })

  it('returns false for a real result object', () => {
    expect(isConflict({ ok: true })).toBe(false)
    expect(isConflict({ conflict: false })).toBe(false)
  })

  it('returns false for primitives and null', () => {
    expect(isConflict(null)).toBe(false)
    expect(isConflict('hello')).toBe(false)
    expect(isConflict(42)).toBe(false)
    expect(isConflict(undefined)).toBe(false)
  })
})
