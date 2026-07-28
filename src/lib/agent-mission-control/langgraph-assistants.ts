/**
 * Agent Mission Control — per-project and per-copilot LangGraph assistant
 * lifecycle (server only).
 *
 * Every Aigent copilot owns a dedicated ASSISTANT on the shared `agent_builder`
 * graph of the LangGraph Agent Server (see the per-COPILOT section below); every
 * Aigent project also owns one, as a fallback for legacy rows predating the
 * per-copilot model. An assistant is a named, metadata-tagged configuration of
 * that one graph — so creating N copilots (or N projects) yields N distinct
 * entities in LangGraph Studio (each inspectable on its own), while they all
 * still run the single shared graph. Runs for a copilot are dispatched against
 * the copilot's own dedicated assistant first, falling back to the project's
 * assistant only for legacy rows (see resolve-run-assistant.ts), not the bare
 * graph id.
 *
 * This module owns only the assistant side. Persisting the returned id onto the
 * `projects` row is the caller's job (authoring-writes.setProjectAssistantId),
 * so the assistant lifecycle and the DB write stay independently testable.
 *
 * Auth/URL come from the shared client factory (langgraph-client.ts) — the same
 * fail-closed `x-agent-key` contract the run/resume path uses, never duplicated.
 *
 * Never import this module from a client component: it builds a server client
 * that carries LANGGRAPH_SERVER_SECRET.
 */
import 'server-only'

import { createHash } from 'node:crypto'

import { buildCopilotBehaviorConfig, type CopilotBehaviorConfig } from './copilot-behavior'
import { computeCostUsd } from './model-pricing'
import { agentServerClient, AGENT_BUILDER_GRAPH_ID } from './langgraph-client'
import { pgrest } from './postgrest'
import type { ModelProvider } from './types'

/**
 * Fixed namespace UUID for deriving an assistant id from an entity id (project
 * OR copilot). Any constant UUID works — it only has to be stable so the same
 * entity id always maps to the same assistant id across retries.
 */
const ASSISTANT_ID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8'

type RawRow = Record<string, unknown>

/**
 * Deterministic RFC-4122 v5 (SHA-1) UUID from `${namespace}:${entityId}`. Passed
 * as the assistant id on create so that `ifExists: 'do_nothing'` actually
 * collides on a retry (same entity → same id) instead of minting a fresh UUID
 * every call. Used for BOTH the per-project (0008) and per-copilot (0009)
 * assistant ids — a single implementation, no duplication. A metadata match
 * alone would NOT dedupe; only a stable id does.
 */
function assistantIdForEntity(entityId: string): string {
  const ns = Buffer.from(ASSISTANT_ID_NAMESPACE.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(ns).update(entityId).digest()
  const bytes = hash.subarray(0, 16)
  bytes[6] = (bytes[6] & 0x0f) | 0x50 // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // RFC-4122 variant
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Assistant id for a project (0008 path). Thin alias over the shared v5 fn. */
function assistantIdForProject(projectId: string): string {
  return assistantIdForEntity(projectId)
}

/** Assistant id for a copilot (0009 path). Thin alias over the shared v5 fn. */
export function assistantIdForCopilot(copilotId: string): string {
  return assistantIdForEntity(copilotId)
}

/**
 * Create (or reuse) the project's dedicated assistant on the shared
 * `agent_builder` graph and return its `assistant_id`. Since migration 0009,
 * this is the fallback path for legacy rows: a run resolves the copilot's own
 * dedicated assistant first (see ensureCopilotAssistant below and
 * resolve-run-assistant.ts) and only falls back to the project's assistant.
 *
 * Contract:
 *  - graph_id is always the shared `agent_builder` graph (one graph, many
 *    assistants) — the assistant is what distinguishes projects, not the graph.
 *  - `name` = the project name, so the assistant is human-recognisable in Studio.
 *  - `metadata` always carries `projectId` (the join back to the `projects` row),
 *    merged with any caller-supplied metadata (e.g. repoFullName). Caller keys
 *    do NOT override `projectId`.
 *  - the assistant id is DETERMINISTIC (v5 UUID from the projectId) and passed
 *    explicitly, so `ifExists: 'do_nothing'` collides on a retry (same projectId
 *    → same id) and the server returns the existing assistant instead of minting
 *    a duplicate. A metadata match alone would NOT dedupe — only a stable id does.
 *
 * Throws (never swallows) on transport/auth failure so the caller can fail the
 * project creation loudly rather than persist a half-wired project.
 */
export async function ensureProjectAssistant(args: {
  projectId: string
  name: string
  metadata?: Record<string, unknown>
}): Promise<string> {
  const c = agentServerClient()
  const assistant = await c.assistants.create({
    assistantId: assistantIdForProject(args.projectId),
    graphId: AGENT_BUILDER_GRAPH_ID,
    name: args.name,
    // projectId is the load-bearing join key — keep it last so a stray
    // `projectId` in caller metadata can never shadow the real one.
    metadata: { ...args.metadata, projectId: args.projectId },
    ifExists: 'do_nothing',
  })
  return assistant.assistant_id
}

/**
 * Best-effort delete of a project's assistant (used to roll back a project
 * creation that failed after the assistant was created, and by project
 * deletion). Never throws: a failed cleanup must not mask the original error —
 * a leftover assistant is inert (it only runs when a project row points a run at
 * it). Returns true on success, false if the delete failed.
 */
export async function deleteProjectAssistant(assistantId: string): Promise<boolean> {
  try {
    const c = agentServerClient()
    await c.assistants.delete(assistantId)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Per-COPILOT assistant (0009) — the primary run target.
//
// Each copilot owns a dedicated assistant whose config.configurable carries its
// FULL behaviour (system prompt, model, step budget, confirmation policy, real
// tools + scope), derived from its manifest+tools and authored originally by the
// Architect IA. The graph reads that config and behaves accordingly. This is the
// entity a run/test/resume targets first (runner/test-runner/resume), the
// per-project assistant (0008) being only a fallback for legacy rows.
// ---------------------------------------------------------------------------

/**
 * Load the copilot's behaviour inputs from the PostgREST perimeter and build its
 * CopilotBehaviorConfig: the copilot row (name/model), its latest manifest
 * (system prompt summary, forbidden actions, confirmation policy, output
 * contract, step budget), its tools rows (name → id/risk/confirmation), and the
 * repo full name of its project (to scope the repo tools). Pure translation
 * lives in copilot-behavior.ts; this function is only the IO around it.
 *
 * Throws NotFoundError-shaped Error if the copilot doesn't exist (fail loud —
 * the caller must not provision an assistant for a phantom copilot).
 */
async function loadCopilotBehaviorConfig(
  copilotId: string
): Promise<{ config: CopilotBehaviorConfig; projectId: string | null }> {
  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id,name,model,model_provider,project_id,production_version_id,latest_version_id`
  )
  const copilot = copilotRows[0]
  if (!copilot) throw new Error(`copilot not found: ${copilotId}`)

  const versionId =
    (typeof copilot.production_version_id === 'string' && copilot.production_version_id.length > 0
      ? copilot.production_version_id
      : null) ??
    (typeof copilot.latest_version_id === 'string' && copilot.latest_version_id.length > 0
      ? copilot.latest_version_id
      : null)

  let manifest: RawRow | null = null
  if (versionId) {
    const versionRows = await pgrest<RawRow[]>(
      'GET',
      `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
    )
    const manifestId = versionRows[0]?.manifest_id
    if (typeof manifestId === 'string' && manifestId.length > 0) {
      const manifestRows = await pgrest<RawRow[]>(
        'GET',
        `manifests?id=eq.${encodeURIComponent(manifestId)}&select=system_prompt_summary,forbidden_actions,confirmation_policy,always_confirm_actions,output_contract,max_steps_per_run,max_cost_per_run_usd`
      )
      manifest = manifestRows[0] ?? null
    }
  }

  // The copilot's tools (name + gating + risk).
  const toolRows = await pgrest<RawRow[]>(
    'GET',
    `tools?copilot_id=eq.${encodeURIComponent(copilotId)}&enabled=eq.true&select=name,risk_level,requires_confirmation&order=name`
  )

  // The project's repo, to scope the repo tools (null for a bench copilot).
  const projectId = (copilot.project_id as string | null) ?? null
  let repoFullName: string | null = null
  if (projectId) {
    const projRows = await pgrest<RawRow[]>(
      'GET',
      `projects?id=eq.${encodeURIComponent(projectId)}&select=repo_full_name`
    )
    repoFullName = (projRows[0]?.repo_full_name as string | null) ?? null
  }

  // Per-1M-token rates resolved HERE, server-side: copilot-behavior.ts is pure
  // and isomorphic, and the graph runs in a separate process that cannot import
  // `model-pricing.ts` (server-only). Without these the graph enforces NO cost
  // ceiling rather than enforcing one against a fabricated rate — so this is
  // what turns the transported `maxCostPerRunUsd` from inert into effective.
  const pricingModel = (copilot.model as string | null) ?? ''
  const pricingProvider = normalizePricingProvider(copilot.model_provider)
  const modelPricing = pricingModel
    ? {
        inputUsdPer1M: computeCostUsd(pricingProvider, pricingModel, 1_000_000, 0),
        outputUsdPer1M: computeCostUsd(pricingProvider, pricingModel, 0, 1_000_000),
      }
    : null

  const config = buildCopilotBehaviorConfig({
    copilot: {
      id: copilot.id as string,
      name: (copilot.name as string) ?? copilotId,
      model: copilot.model as string | null,
      model_provider: copilot.model_provider as never,
    },
    manifest: manifest as never,
    tools: toolRows.map((t) => ({
      name: t.name as string,
      risk_level: t.risk_level as never,
      requires_confirmation: t.requires_confirmation as boolean | null,
    })),
    repoFullName,
    modelPricing,
  })

  return { config, projectId }
}

/**
 * Create (or refresh) the copilot's dedicated assistant on the shared
 * `agent_builder` graph, with `config.configurable` = the copilot's full
 * CopilotBehaviorConfig, and return its assistant_id.
 *
 * Idempotent AND self-updating:
 *  - assistant id is DETERMINISTIC (v5 of the copilotId), passed explicitly, so
 *    `ifExists: 'do_nothing'` collides on a retry instead of minting duplicates.
 *  - because `do_nothing` does NOT update the config of a pre-existing assistant,
 *    we ALWAYS follow the create with an `assistants.update(id, {config,
 *    metadata})`. On first create it's a harmless no-op-ish rewrite; on a
 *    subsequent call (copilot behaviour changed — manifest/tools edited) it
 *    pushes the NEW config so the assistant tracks the copilot. update is chosen
 *    over delete+create so the assistant id (and any attached threads) survive.
 *  - metadata always carries {copilotId, projectId} (the joins back to the DB).
 *
 * Throws (never swallows) on transport/auth failure so the caller can fail the
 * copilot creation loudly rather than persist a half-wired copilot.
 */
/**
 * Narrow a raw `copilots.model_provider` to a priceable provider. An unknown or
 * legacy value falls back to 'openai' — the same default the behavior builder
 * applies — so the rate table is queried with a value it knows rather than
 * silently yielding no pricing (which would disable the ceiling entirely).
 */
function normalizePricingProvider(raw: unknown): ModelProvider {
  return raw === 'google' || raw === 'local' ? raw : 'openai'
}

export async function ensureCopilotAssistant(args: { copilotId: string }): Promise<string> {
  const { copilotId } = args
  const { config, projectId } = await loadCopilotBehaviorConfig(copilotId)

  const assistantId = assistantIdForCopilot(copilotId)
  const c = agentServerClient()

  // 1) Create if absent (deterministic id → collides on retry, no duplicate).
  await c.assistants.create({
    assistantId,
    graphId: AGENT_BUILDER_GRAPH_ID,
    name: config.copilotName,
    config: { configurable: { ...config } },
    // copilotId last so a stray key in a future metadata source can't shadow it.
    metadata: { projectId, copilotId },
    ifExists: 'do_nothing',
  })

  // 2) Push the current config regardless of whether the assistant is new or
  //    pre-existing — `do_nothing` never updates an existing assistant's config,
  //    so this is what makes the behaviour track the copilot over time.
  await c.assistants.update(assistantId, {
    config: { configurable: { ...config } },
    metadata: { projectId, copilotId },
    name: config.copilotName,
  })

  return assistantId
}

/**
 * Best-effort delete of a copilot's assistant (rollback of a failed copilot
 * provisioning, and copilot deletion). Takes the resolved `assistant_id` (not a
 * copilotId) — callers must resolve it first (e.g. via assistantIdForCopilot).
 * Never throws — a leftover assistant is inert (it only runs when a copilot
 * points a run at it).
 */
export async function deleteCopilotAssistant(assistantId: string): Promise<boolean> {
  try {
    const c = agentServerClient()
    await c.assistants.delete(assistantId)
    return true
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Per-CANDIDATE-VERSION ephemeral assistant (AIGENT-DETERMINISTIC-EVIDENCE-001)
//
// The per-copilot assistant above carries the copilot's CURRENT manifest. A
// shadow/replay of a langgraph CANDIDATE that changed its prompt/tools/policy
// therefore runs against a STALE config — the exact limitation documented in
// shadow-replay-routes-shared.ts, and the reason the directive requires a way to
// execute a precise candidate version in LangGraph WITHOUT touching the
// production assistant.
//
// The fix: an EPHEMERAL assistant whose config is built from the CANDIDATE
// version's own manifest (`copilot_versions.manifest_id`), keyed by a
// VERSION-scoped id in a DISTINCT namespace from the copilot's assistant, so it
// can never collide with — or mutate — the production assistant. A shadow/replay
// run provisions it, runs against it, and deletes it.
//
// NOTE ON VERIFICATION: `loadCandidateBehaviorConfig` is pure of the Agent Server
// (pgrest reads + the pure builder) and is unit-tested offline. The provisioning
// pair (`ensureCandidateAssistant`/`deleteCandidateAssistant`) reaches the Agent
// Server; a real billed candidate run is a separate, agreement-gated step and is
// not exercised here.
// ---------------------------------------------------------------------------

/**
 * Version-scoped assistant id, in a namespace DISTINCT from the copilot's
 * (prefixing the version id) so `assistantIdForCandidate(v)` can never equal
 * `assistantIdForCopilot(copilotId)` — the ephemeral assistant is a separate
 * entity that leaves the production assistant untouched.
 */
export function assistantIdForCandidate(versionId: string): string {
  return assistantIdForEntity(`candidate-version:${versionId}`)
}

/**
 * Build the behaviour config for a SPECIFIC candidate VERSION from THAT version's
 * manifest (`copilot_versions.manifest_id`), not the copilot's latest. This is
 * the faithfulness fix for the shadow/replay langgraph limitation. Pure of the
 * Agent Server — only pgrest reads + the pure builder — so it is unit-testable.
 * Throws (never provisions for a phantom) if the version or its copilot is gone.
 */
export async function loadCandidateBehaviorConfig(
  versionId: string
): Promise<{ config: CopilotBehaviorConfig; copilotId: string; projectId: string | null }> {
  const versionRows = await pgrest<RawRow[]>(
    'GET',
    `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=id,copilot_id,manifest_id`
  )
  const version = versionRows[0]
  if (!version) throw new Error(`candidate version not found: ${versionId}`)
  const copilotId = version.copilot_id as string
  const manifestId = version.manifest_id as string | null

  const copilotRows = await pgrest<RawRow[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id,name,model,model_provider,project_id`
  )
  const copilot = copilotRows[0]
  if (!copilot) throw new Error(`copilot not found for candidate version ${versionId}`)

  // The CANDIDATE version's OWN manifest — the faithfulness fix (vs the copilot's
  // latest). Null-safe: a candidate without a manifest yields the builder's
  // default prompt, exactly as the per-copilot path does.
  let manifest: RawRow | null = null
  if (manifestId) {
    const manifestRows = await pgrest<RawRow[]>(
      'GET',
      `manifests?id=eq.${encodeURIComponent(manifestId)}&select=system_prompt_summary,forbidden_actions,confirmation_policy,always_confirm_actions,output_contract,max_steps_per_run,max_cost_per_run_usd`
    )
    manifest = manifestRows[0] ?? null
  }

  // Tools are copilot-scoped in this schema (no per-version tool set), so the
  // candidate inherits the copilot's enabled tools — same read as the per-copilot
  // path. The manifest-carried behaviour (prompt/policy/budget) is what the
  // candidate version actually changes, and that IS resolved per-version above.
  const toolRows = await pgrest<RawRow[]>(
    'GET',
    `tools?copilot_id=eq.${encodeURIComponent(copilotId)}&enabled=eq.true&select=name,risk_level,requires_confirmation&order=name`
  )

  const projectId = (copilot.project_id as string | null) ?? null
  let repoFullName: string | null = null
  if (projectId) {
    const projRows = await pgrest<RawRow[]>(
      'GET',
      `projects?id=eq.${encodeURIComponent(projectId)}&select=repo_full_name`
    )
    repoFullName = (projRows[0]?.repo_full_name as string | null) ?? null
  }

  const pricingModel = (copilot.model as string | null) ?? ''
  const pricingProvider = normalizePricingProvider(copilot.model_provider)
  const modelPricing = pricingModel
    ? {
        inputUsdPer1M: computeCostUsd(pricingProvider, pricingModel, 1_000_000, 0),
        outputUsdPer1M: computeCostUsd(pricingProvider, pricingModel, 0, 1_000_000),
      }
    : null

  const config = buildCopilotBehaviorConfig({
    copilot: {
      id: copilot.id as string,
      name: (copilot.name as string) ?? copilotId,
      model: copilot.model as string | null,
      model_provider: copilot.model_provider as never,
    },
    manifest: manifest as never,
    tools: toolRows.map((t) => ({
      name: t.name as string,
      risk_level: t.risk_level as never,
      requires_confirmation: t.requires_confirmation as boolean | null,
    })),
    repoFullName,
    modelPricing,
  })

  return { config, copilotId, projectId }
}

/**
 * Provision (or refresh) the EPHEMERAL candidate assistant for `versionId` and
 * return its assistant_id. Config = the candidate version's own manifest; id =
 * version-scoped (never the copilot's). Same idempotent create+update pattern as
 * ensureCopilotAssistant, so a retry collides instead of duplicating. Reaches the
 * Agent Server — callers MUST `deleteCandidateAssistant` when the run finishes.
 */
export async function ensureCandidateAssistant(versionId: string): Promise<string> {
  const { config, copilotId, projectId } = await loadCandidateBehaviorConfig(versionId)
  const assistantId = assistantIdForCandidate(versionId)
  const c = agentServerClient()
  const metadata = { projectId, copilotId, candidateVersionId: versionId, ephemeral: true }

  await c.assistants.create({
    assistantId,
    graphId: AGENT_BUILDER_GRAPH_ID,
    name: `candidate ${versionId}`,
    config: { configurable: { ...config } },
    metadata,
    ifExists: 'do_nothing',
  })
  // do_nothing never updates an existing config → push the candidate config so a
  // re-provision tracks the version rather than an earlier one.
  await c.assistants.update(assistantId, {
    config: { configurable: { ...config } },
    metadata,
    name: `candidate ${versionId}`,
  })
  return assistantId
}

/**
 * Best-effort delete of a candidate's ephemeral assistant (run cleanup). Never
 * throws — a leftover assistant is inert until a run targets it, and the id is
 * version-scoped so it can only ever be re-created by another candidate run.
 */
export async function deleteCandidateAssistant(versionId: string): Promise<boolean> {
  try {
    const c = agentServerClient()
    await c.assistants.delete(assistantIdForCandidate(versionId))
    return true
  } catch {
    return false
  }
}
