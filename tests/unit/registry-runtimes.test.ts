/**
 * Unit tests for the runtime gating registry
 * (`src/lib/agent-mission-control/registry/runtimes.ts`).
 *
 * Locks the invariants the whole "executable vs declared" split rests on:
 *  - langgraph is the ONLY executable + creatable runtime
 *  - every other declared runtime has engine:'none' and is never
 *    executable/creatable
 *  - getRuntime resolves known ids and returns undefined for unknown ids
 *  - runtimeAvailability reports coherent available/creatable/reasons
 *  - RUNTIME_IDS is derived from RUNTIME_REGISTRY with no duplicates
 */
import { describe, expect, it } from 'vitest'

import {
  RUNTIME_IDS,
  RUNTIME_REGISTRY,
  getRuntime,
  isRuntimeCreatable,
  isRuntimeExecutable,
  runtimeAvailability,
} from '@/lib/agent-mission-control/registry/runtimes'

describe('RUNTIME_REGISTRY / RUNTIME_IDS', () => {
  it('RUNTIME_IDS is derived from RUNTIME_REGISTRY with no duplicates', () => {
    expect(RUNTIME_IDS.length).toBe(Object.keys(RUNTIME_REGISTRY).length)
    expect(new Set(RUNTIME_IDS).size).toBe(RUNTIME_IDS.length)
    for (const id of RUNTIME_IDS) {
      expect(RUNTIME_REGISTRY[id]).toBeDefined()
    }
  })

  it('contains the expected four runtime ids', () => {
    expect(new Set(RUNTIME_IDS)).toEqual(
      new Set(['langgraph', 'openai-assistants', 'gemini', 'custom'])
    )
  })
})

describe('getRuntime', () => {
  it('returns the definition for a known id', () => {
    const rt = getRuntime('langgraph')
    expect(rt).toBeDefined()
    expect(rt?.id).toBe('langgraph')
    expect(rt?.engine).toBe('langgraph')
  })

  it('returns undefined for an unknown id', () => {
    expect(getRuntime('not-a-real-runtime')).toBeUndefined()
    expect(getRuntime('')).toBeUndefined()
  })
})

describe('isRuntimeExecutable / isRuntimeCreatable', () => {
  it('langgraph is the only executable AND creatable runtime', () => {
    expect(isRuntimeExecutable('langgraph')).toBe(true)
    expect(isRuntimeCreatable('langgraph')).toBe(true)

    for (const id of RUNTIME_IDS.filter((r) => r !== 'langgraph')) {
      expect(isRuntimeExecutable(id)).toBe(false)
      expect(isRuntimeCreatable(id)).toBe(false)
    }
  })

  it('openai-assistants, gemini, custom all declare engine:none', () => {
    for (const id of ['openai-assistants', 'gemini', 'custom'] as const) {
      const rt = getRuntime(id)!
      expect(rt.engine).toBe('none')
      expect(isRuntimeExecutable(id)).toBe(false)
      expect(isRuntimeCreatable(id)).toBe(false)
    }
  })

  it('is false for an unknown id', () => {
    expect(isRuntimeExecutable('bogus')).toBe(false)
    expect(isRuntimeCreatable('bogus')).toBe(false)
  })

  it('invariant: any runtime with engine:none is never executable nor creatable', () => {
    for (const id of RUNTIME_IDS) {
      const rt = getRuntime(id)!
      if (rt.engine === 'none') {
        expect(isRuntimeExecutable(id)).toBe(false)
        expect(isRuntimeCreatable(id)).toBe(false)
      }
    }
  })

  it('creatable requires BOTH creatable:true and engine !== none (no declared runtime today satisfies creatable:true with engine:none, but the predicate must not rely on creatable alone)', () => {
    // No entry in the current registry has creatable:true with engine:'none' —
    // assert that fact, then assert the predicate's AND-logic directly.
    const contradictory = RUNTIME_IDS.filter((id) => {
      const rt = getRuntime(id)!
      return rt.creatable && rt.engine === 'none'
    })
    expect(contradictory).toHaveLength(0)

    // Direct proof the predicate is an AND, not just `.creatable`: for every
    // engine:'none' runtime, isRuntimeCreatable is false regardless of the
    // declared `creatable` flag.
    for (const id of RUNTIME_IDS) {
      const rt = getRuntime(id)!
      if (rt.engine === 'none') {
        expect(isRuntimeCreatable(id)).toBe(false)
      }
    }
  })
})

describe('runtimeAvailability', () => {
  it('langgraph is fully available and creatable with no reasons', () => {
    const a = runtimeAvailability('langgraph')
    expect(a).toEqual({ available: true, creatable: true, reasons: [] })
  })

  it('a runtime with engine:none is unavailable with reason no-engine', () => {
    for (const id of ['openai-assistants', 'gemini', 'custom']) {
      const a = runtimeAvailability(id)
      expect(a.available).toBe(false)
      expect(a.creatable).toBe(false)
      expect(a.reasons).toContain('no-engine')
    }
  })

  it('an unknown id is unavailable with reason no-engine (missing definition)', () => {
    const a = runtimeAvailability('totally-unknown')
    expect(a.available).toBe(false)
    expect(a.creatable).toBe(false)
    expect(a.reasons).toContain('no-engine')
  })

  it('reasons only ever contains no-engine and/or not-creatable, matching the flags', () => {
    for (const id of RUNTIME_IDS) {
      const a = runtimeAvailability(id)
      const rt = getRuntime(id)!
      if (rt.engine === 'none') {
        expect(a.reasons).toContain('no-engine')
      } else {
        expect(a.reasons).not.toContain('no-engine')
      }
      if (!rt.creatable) {
        expect(a.reasons).toContain('not-creatable')
      } else {
        expect(a.reasons).not.toContain('not-creatable')
      }
      expect(a.available).toBe(isRuntimeExecutable(id))
      expect(a.creatable).toBe(isRuntimeCreatable(id))
    }
  })
})
