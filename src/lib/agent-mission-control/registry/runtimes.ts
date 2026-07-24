/**
 * Canonical Runtime Registry — the single source of truth for which execution
 * engines exist, what they can do, and whether they are actually available.
 *
 * AIGENT-CORE-FACTORY-035, Phase 3. Before this module, "runtime" was a bare
 * TS union (`AgentRuntime` in types.ts) with no engine, no capability, no
 * health, no availability. A copilot could carry `runtime: 'gemini'` — a purely
 * DECLARATIVE value with no real engine behind it — and nothing refused it: the
 * fork in runner.ts (`if (runtime === 'langgraph') …`) simply dropped every
 * non-langgraph value into an implicit "else" that runs the direct model-router
 * loop, so `'gemini'`/`'custom'` silently meant "direct path" rather than "not
 * executable".
 *
 * This registry makes execution capability EXPLICIT and refusable. A runtime
 * that declares `engine: 'none'` cannot be selected at creation, cannot be
 * persisted as executable, cannot show as available, and fails the release gate.
 *
 * PURE + ISOMORPHIC on purpose: no server-only import, no @langchain, no
 * PostgREST. Safe to import from the builder, the validator, the run gate, the
 * catalogue, the UI, the tests and the gates — so they all read ONE authority
 * instead of each recomputing "is this runtime real?".
 */

import type { AgentRuntime } from '../types'

/**
 * A runtime's real backing. `langgraph`/`model-router` are the two engines that
 * actually execute in this repo (confirmed: runner.ts forks on `langgraph`,
 * everything else falls to the direct model-router loop). `none` means the id is
 * declared for historical/typing reasons but has NO engine — it must never be
 * treated as executable.
 */
export type RuntimeEngine = 'langgraph' | 'model-router' | 'none'

/** Why a runtime is unavailable, when it is. Empty for an available runtime. */
export type RuntimeUnavailableReason =
  | 'no-engine'
  | 'not-creatable'
  | 'server-not-configured'

export interface RuntimeCapabilities {
  /** The runtime can mount and call tools during a run. */
  tools: boolean
  /** Token/step streaming is supported. */
  streaming: boolean
  /** Human-in-the-loop interrupt/resume is supported. */
  hitl: boolean
  /** Durable checkpoints (thread resume) are supported. */
  checkpoints: boolean
  /** Telemetry/trace emission is supported. */
  telemetry: boolean
}

export interface RuntimeDefinition {
  /** Stable id — a member of the AgentRuntime union (kept in sync by a gate). */
  id: AgentRuntime
  /** Human label for the UI. */
  label: string
  /** The real backing engine. `none` ⇒ never executable. */
  engine: RuntimeEngine
  /**
   * Can an author SELECT this runtime when creating an agent? Today only
   * `langgraph` is creatable (mirrors `CreatableAgentRuntime` + copilots/route).
   */
  creatable: boolean
  /** Compatible model providers. Empty ⇒ provider-agnostic / not applicable. */
  modelProviders: ReadonlyArray<'openai' | 'google' | 'local'>
  capabilities: RuntimeCapabilities
  /** One-line note on the engine's real status. */
  note: string
}

const NO_CAPS: RuntimeCapabilities = {
  tools: false,
  streaming: false,
  hitl: false,
  checkpoints: false,
  telemetry: false,
}

/**
 * THE runtimes. One entry per `AgentRuntime` member — the gate
 * (check-registry-integrity) asserts this set is exactly the union, so a new
 * runtime id can never be added to the type without a real definition here.
 */
export const RUNTIME_REGISTRY: Readonly<Record<AgentRuntime, RuntimeDefinition>> = {
  langgraph: {
    id: 'langgraph',
    label: 'LangGraph',
    engine: 'langgraph',
    creatable: true,
    modelProviders: ['openai', 'google', 'local'],
    capabilities: { tools: true, streaming: true, hitl: true, checkpoints: true, telemetry: true },
    note: 'LangGraph Agent Server — the mandatory runtime for every agent (AGENTS.md). Real engine.',
  },
  'openai-assistants': {
    id: 'openai-assistants',
    label: 'OpenAI Assistants',
    engine: 'none',
    creatable: false,
    modelProviders: [],
    capabilities: NO_CAPS,
    note: 'Declared in the type for historical reasons. No engine wired — not executable.',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini (direct)',
    engine: 'none',
    creatable: false,
    modelProviders: [],
    capabilities: NO_CAPS,
    note: 'Not a distinct engine — Gemini is reached as a model provider under langgraph/model-router, not as its own runtime.',
  },
  custom: {
    id: 'custom',
    label: 'Custom',
    engine: 'none',
    creatable: false,
    modelProviders: [],
    capabilities: NO_CAPS,
    note: 'Placeholder for a future bespoke engine. No engine today — not executable.',
  },
}

/** Every runtime id the registry knows, derived (never hand-listed). */
export const RUNTIME_IDS: ReadonlyArray<AgentRuntime> = Object.keys(
  RUNTIME_REGISTRY
) as AgentRuntime[]

/** Look up a runtime definition, or `undefined` for an unknown id. */
export function getRuntime(id: string): RuntimeDefinition | undefined {
  return (RUNTIME_REGISTRY as Record<string, RuntimeDefinition>)[id]
}

/**
 * A runtime is EXECUTABLE iff it has a real engine. This is the single predicate
 * the validator, run gate and release gate must call — never a hardcoded
 * `=== 'langgraph'` scattered per consumer.
 */
export function isRuntimeExecutable(id: string): boolean {
  const rt = getRuntime(id)
  return !!rt && rt.engine !== 'none'
}

/** A runtime is CREATABLE iff an author may select it AND it is executable. */
export function isRuntimeCreatable(id: string): boolean {
  const rt = getRuntime(id)
  return !!rt && rt.creatable && rt.engine !== 'none'
}

/**
 * Structured availability for a runtime id — reasons are machine-readable so the
 * builder/UI can explain a refusal instead of a bare boolean.
 */
export function runtimeAvailability(id: string): {
  available: boolean
  creatable: boolean
  reasons: RuntimeUnavailableReason[]
} {
  const rt = getRuntime(id)
  const reasons: RuntimeUnavailableReason[] = []
  if (!rt || rt.engine === 'none') reasons.push('no-engine')
  if (rt && !rt.creatable) reasons.push('not-creatable')
  return {
    available: !!rt && rt.engine !== 'none',
    creatable: !!rt && rt.creatable && rt.engine !== 'none',
    reasons,
  }
}
