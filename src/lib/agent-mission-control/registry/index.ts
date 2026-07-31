/**
 * Canonical registry — public surface + version fingerprint.
 *
 * AIGENT-CORE-FACTORY-035. Re-exports the runtime + tool registries and derives
 * the ONE thing every consumer needs but must never hand-maintain: the set of
 * known ids, and a `REGISTRY_HASH` that fingerprints the whole registry
 * contract. A run's evidence records this hash; a DB catalogue projection
 * carries it; the integrity gate compares it — so "which registry produced this"
 * is always answerable, and a stale projection is detectable.
 *
 * PURE + ISOMORPHIC: no server-only import.
 */

import { RUNTIME_REGISTRY, RUNTIME_IDS } from './runtimes'
import { TOOL_REGISTRY, TOOL_IDS } from './tools'

export * from './runtimes'
export * from './tools'

/**
 * Deterministic 32-bit FNV-1a hash of a string. Small, dependency-free, stable
 * across processes — good enough to fingerprint the registry contract (this is
 * a drift detector, not a cryptographic digest).
 */
function fnv1a(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // 32-bit FNV prime multiply via shifts (keeps it in 32-bit range).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/**
 * A canonical, stable serialization of the registry contract: every tool and
 * runtime, key-sorted, with the fields that define executability. Two processes
 * with the same registry source produce the same string → the same hash.
 */
export function registryFingerprintSource(): string {
  const tools = TOOL_IDS.toSorted((a, b) => a.localeCompare(b))
    .map((id) => {
      const t = TOOL_REGISTRY[id]
      return [
        t.id,
        t.version,
        t.kind,
        t.mutates ? 'M' : 'r',
        t.risk,
        t.requiresConfirmation ? 'C' : 'c',
        t.certification,
        t.runtimes.toSorted((a, b) => a.localeCompare(b)).join('+'),
        t.secretRefs.toSorted((a, b) => a.localeCompare(b)).join(','),
      ].join('|')
    })
  const runtimes = RUNTIME_IDS.toSorted((a, b) => a.localeCompare(b))
    .map((id) => {
      const r = RUNTIME_REGISTRY[id]
      return [r.id, r.engine, r.creatable ? 'C' : 'c'].join('|')
    })
  return `T:${tools.join('\n')}\nR:${runtimes.join('\n')}`
}

/** The registry contract fingerprint. Recorded in run evidence + DB projection. */
export const REGISTRY_HASH: string = fnv1a(registryFingerprintSource())
