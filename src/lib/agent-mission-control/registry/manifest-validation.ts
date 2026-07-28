/**
 * Registry-backed manifest validation (AIGENT-CORE-FACTORY-035, Phase 7).
 *
 * Eager, pure classification of a manifest's declared tools + runtime against
 * the canonical registry — the thing that turns a phantom tool from a silent
 * run-time "no data" into an authoring-time NEEDS_TOOL. Before this, a manifest
 * could name any tool string; the graph would drop the unknown id and the agent
 * would look healthy while mounting nothing (the exact failure the registry
 * exists to end).
 *
 * PURE + ISOMORPHIC: no server-only import, no IO. The API route uses it to
 * refuse persisting a manifest that needs a tool the platform can't build; the
 * Factory UI uses the SAME function to show, live, which capabilities are
 * covered, which need a Tool Builder mission, and which are impossible.
 */

import { getTool, isToolCertified, TOOL_IDS } from './tools'
import { isRuntimeCreatable, isRuntimeExecutable, runtimeAvailability } from './runtimes'

/** How a single declared tool resolves against the canonical registry. */
export type ToolResolution =
  | 'certified' // real, certified, mountable now
  | 'uncertified' // declared in the registry but not certified (draft/deprecated)
  | 'phantom' // no registry entry at all → the platform cannot build it

export interface DeclaredTool {
  /** The registry id the manifest references. */
  id: string
  /** Whether the author marked this tool optional (may be missing without blocking). */
  optional?: boolean
}

export interface ToolValidationEntry {
  id: string
  optional: boolean
  resolution: ToolResolution
  /** For a certified tool: whether its handler mutates state (drives HITL rules). */
  mutates: boolean | null
}

export interface ManifestValidationResult {
  /** true only when the manifest is fully valid AND immediately provisionable. */
  ok: boolean
  /** true when no REQUIRED tool is phantom/uncertified, but optional gaps exist. */
  degradable: boolean
  runtime: {
    id: string
    executable: boolean
    creatable: boolean
    reasons: string[]
  }
  tools: ToolValidationEntry[]
  /** Required tools the platform cannot build → the agent is NEEDS_TOOL. */
  missingRequired: string[]
  /** Optional tools unavailable → agent still activatable, degraded. */
  missingOptional: string[]
  /** Machine-readable blocker reasons (empty ⇒ ok). */
  blockers: string[]
}

function classify(id: string): ToolResolution {
  const t = getTool(id)
  if (!t) return 'phantom'
  return isToolCertified(id) ? 'certified' : 'uncertified'
}

/**
 * Validate a manifest's runtime + declared tools against the canonical registry.
 * Deterministic, no IO. `runtimeId` and `tools` come straight off the manifest.
 */
export function validateManifestAgainstRegistry(
  runtimeId: string,
  tools: ReadonlyArray<DeclaredTool>
): ManifestValidationResult {
  const rtAvail = runtimeAvailability(runtimeId)
  const blockers: string[] = []

  if (!isRuntimeExecutable(runtimeId)) {
    blockers.push(`runtime "${runtimeId}" has no real engine`)
  } else if (!isRuntimeCreatable(runtimeId)) {
    // Executable but not author-selectable — allowed for existing agents, but a
    // NEW manifest should not pick it. Surfaced as a blocker; the API decides.
    blockers.push(`runtime "${runtimeId}" is not selectable at creation`)
  }

  const entries: ToolValidationEntry[] = []
  const missingRequired: string[] = []
  const missingOptional: string[] = []

  for (const decl of tools) {
    const resolution = classify(decl.id)
    const t = getTool(decl.id)
    const optional = decl.optional === true
    entries.push({
      id: decl.id,
      optional,
      resolution,
      mutates: t ? t.mutates : null,
    })
    if (resolution !== 'certified') {
      if (optional) missingOptional.push(decl.id)
      else missingRequired.push(decl.id)
    }
  }

  for (const id of missingRequired) {
    blockers.push(`required tool "${id}" is ${classify(id)} — not buildable`)
  }

  const ok = blockers.length === 0

  return {
    ok,
    // Degradable = the runtime is real, every REQUIRED tool resolves, and only
    // OPTIONAL tools are missing — the agent can still activate, just narrower.
    degradable: missingRequired.length === 0 && missingOptional.length > 0 && rtAvail.available,
    runtime: {
      id: runtimeId,
      executable: rtAvail.available,
      creatable: rtAvail.creatable,
      reasons: rtAvail.reasons,
    },
    tools: entries,
    missingRequired,
    missingOptional,
    blockers,
  }
}
