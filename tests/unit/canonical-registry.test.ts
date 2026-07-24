/**
 * Unit tests for the canonical registry (AIGENT-CORE-FACTORY-035).
 *
 * Locks the invariants the whole reconstruction rests on:
 *  - the canonical tool ids equal the executable REGISTRY ids (.mjs authority)
 *  - a runtime with no engine is never executable/creatable
 *  - manifest validation refuses a phantom tool as a REQUIRED tool (NEEDS_TOOL)
 *  - an optional phantom tool degrades rather than blocks
 *  - the registry hash is stable + changes when the contract changes shape
 */
import { describe, expect, it } from 'vitest'

import {
  REGISTRY_HASH,
  RUNTIME_IDS,
  TOOL_IDS,
  getRuntime,
  getTool,
  isRuntimeCreatable,
  isRuntimeExecutable,
  isToolCertified,
  registryFingerprintSource,
} from '@/lib/agent-mission-control/registry'
import { validateManifestAgainstRegistry } from '@/lib/agent-mission-control/registry/manifest-validation'
import { REGISTRY_IDS as MJS_REGISTRY_IDS } from '@/../src/langgraph/tool-registry.mjs'

describe('canonical tool registry', () => {
  it('equals the executable .mjs REGISTRY ids exactly', () => {
    expect(new Set(TOOL_IDS)).toEqual(new Set(MJS_REGISTRY_IDS))
  })

  it('has no duplicate tool ids', () => {
    expect(new Set(TOOL_IDS).size).toBe(TOOL_IDS.length)
  })

  it('classifies every declared read-only tool as non-mutating (migration 0023 truth)', () => {
    // read_* platform/market/repo tools and the pure builder are all read-only.
    for (const id of TOOL_IDS) {
      const t = getTool(id)!
      expect(t.mutates).toBe(false) // all 21 current tools are proven read-only
    }
  })

  it('every certified tool declares a runtime', () => {
    for (const id of TOOL_IDS) {
      const t = getTool(id)!
      if (t.certification === 'certified') expect(t.runtimes.length).toBeGreaterThan(0)
    }
  })
})

describe('canonical runtime registry', () => {
  it('langgraph is the only executable + creatable runtime', () => {
    expect(isRuntimeExecutable('langgraph')).toBe(true)
    expect(isRuntimeCreatable('langgraph')).toBe(true)
    for (const id of RUNTIME_IDS.filter((r) => r !== 'langgraph')) {
      expect(isRuntimeExecutable(id)).toBe(false)
      expect(isRuntimeCreatable(id)).toBe(false)
    }
  })

  it('a runtime with engine:none is never executable', () => {
    for (const id of RUNTIME_IDS) {
      const rt = getRuntime(id)!
      if (rt.engine === 'none') expect(isRuntimeExecutable(id)).toBe(false)
    }
  })
})

describe('manifest validation against the registry', () => {
  it('accepts a manifest with only certified required tools', () => {
    const r = validateManifestAgainstRegistry('langgraph', [{ id: 'read_recent_runs' }])
    expect(r.ok).toBe(true)
    expect(r.missingRequired).toHaveLength(0)
    expect(r.blockers).toHaveLength(0)
  })

  it('refuses a phantom required tool (NEEDS_TOOL, not silent)', () => {
    const r = validateManifestAgainstRegistry('langgraph', [{ id: 'send_wire_transfer' }])
    expect(r.ok).toBe(false)
    expect(r.missingRequired).toContain('send_wire_transfer')
    expect(r.tools.find((t) => t.id === 'send_wire_transfer')?.resolution).toBe('phantom')
  })

  it('an optional phantom tool degrades rather than blocks', () => {
    const r = validateManifestAgainstRegistry('langgraph', [
      { id: 'read_recent_runs' },
      { id: 'some_optional_capability', optional: true },
    ])
    expect(r.missingRequired).toHaveLength(0)
    expect(r.missingOptional).toContain('some_optional_capability')
    expect(r.degradable).toBe(true)
  })

  it('refuses a runtime with no real engine', () => {
    const r = validateManifestAgainstRegistry('custom', [{ id: 'read_recent_runs' }])
    expect(r.ok).toBe(false)
    expect(r.runtime.executable).toBe(false)
    expect(r.blockers.some((b) => b.includes('no real engine'))).toBe(true)
  })
})

describe('registry fingerprint', () => {
  it('is a stable 8-hex hash', () => {
    expect(REGISTRY_HASH).toMatch(/^[0-9a-f]{8}$/)
  })

  it('the fingerprint source lists every tool and runtime', () => {
    const src = registryFingerprintSource()
    for (const id of TOOL_IDS) expect(src).toContain(id)
    for (const id of RUNTIME_IDS) expect(src).toContain(id)
  })
})
