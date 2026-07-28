/**
 * Available agents — THE canonical runtime read (server only).
 *
 * One contract, one resolver, one truth: an agent appears here only when a
 * PERSISTED row says so. There is no static catalogue, no fixture, no seed, no
 * demo entry and no fallback — the module reads the same live PostgREST
 * perimeter as `data.ts`, so an unreachable backend throws instead of degrading
 * into an invented list (see `data.ts` header).
 *
 * The rules this module encodes, and why:
 *
 * 1. A MANIFEST IS NOT AN AGENT. Being described in a manifest row proves an
 *    intention, not an execution path. Availability additionally requires a
 *    real project, a configured provider, a resolved model, a persisted
 *    version and registered tools — checked one by one below.
 *
 * 2. NOTHING IS DEFAULTED TO HEALTHY. `status` is computed from runtime truth;
 *    an agent is never `active` merely because a row exists. Absence of proof
 *    yields `unavailable`, never a reassuring value.
 *
 * 3. ABSENT ≠ ZERO. Every field that cannot be resolved is `null` (or an empty
 *    array) AND named in `unavailableFields`, so a consumer can tell "not
 *    measured" from "measured as nothing". An unknown cost is never `0`, an
 *    unknown model is never `gpt-…`, an unknown provider is never `openai`.
 */
import 'server-only'

import { z } from 'zod'

import { TRADING_TOOL_HANDLERS } from './market/tools'
import { REALESTATE_TOOL_HANDLERS } from './realestate/tools'
import { pgrest } from './postgrest'
import { NON_EVALUATION_RUN_FILTER } from './types'
import type { AgentRunStatus, ConfirmationPolicy, ModelProvider, VersionStage } from './types'

/**
 * Tool names the runner can actually execute, mirroring TOOL_HANDLERS.
 *
 * Derived from the same registries `tool-handlers.ts` composes rather than
 * imported from it: that module pulls in the LangGraph draft builder and the
 * data layer, and importing it here would drag the run path into every page
 * that renders the catalogue. The five native handlers are listed explicitly
 * because they are defined inline in `tool-handlers.ts`;
 * `tests/unit/tradeagent-only-roster.test.ts` pins the full set so a handler
 * added there without updating this list fails the gate.
 */
const NATIVE_TOOL_NAMES = [
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
] as const

/**
 * CAVEAT — this set describes the DIRECT path, but every agent now runs on
 * LangGraph (`runtime: 'langgraph'` is mandatory), where tools are mounted by
 * src/langgraph/tool-registry.mjs instead. A name present here but absent there
 * is mounted by nothing: the catalogue would derive `active` for an agent whose
 * tools silently never load (`buildToolsFromConfig` skips unknown ids).
 *
 * `scripts/check-registry-parity.mjs` (in `npm run check`) asserts the two
 * registries agree, so this set cannot drift into that lie unnoticed.
 */
const RUNNABLE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...NATIVE_TOOL_NAMES,
  ...Object.keys(TRADING_TOOL_HANDLERS),
  ...Object.keys(REALESTATE_TOOL_HANDLERS),
])

type RawRow = Record<string, unknown>

const rest = <T>(pathAndQuery: string): Promise<T> => pgrest<T>('GET', pathAndQuery)

/**
 * Runtime availability, derived — never stored, never defaulted.
 *
 * - `active`      executable AND currently serving (status active, or a version in production)
 * - `inactive`    executable but deliberately not serving (draft / paused)
 * - `degraded`    executable path exists but something real is broken — today:
 *                 declared tools that resolve to no registered tool row
 * - `unavailable` NOT executable: retired (`archived`), or a hard requirement is
 *                 missing (project, provider, model, version or manifest)
 *
 * `archived` is checked first and maps to `unavailable`, never `inactive`:
 * retirement is a decision, not a pause, and the two must not read alike.
 */
export const AVAILABLE_AGENT_STATUSES = ['active', 'inactive', 'degraded', 'unavailable'] as const
export type AvailableAgentStatus = (typeof AVAILABLE_AGENT_STATUSES)[number]

export const AvailableAgentSchema = z
  .object({
    copilotId: z.string().min(1),
    projectId: z.string().min(1).nullable(),
    name: z.string().min(1),
    description: z.string().nullable(),
    version: z.string().nullable(),
    /** RUNTIME status — what the runtime can prove today. See `labels.ts`. */
    status: z.enum(AVAILABLE_AGENT_STATUSES),
    /**
     * LIFECYCLE status — the raw `copilots.status` column, unaltered.
     *
     * Surfaced so a view can show the operator's decision (`draft`, `paused`…)
     * NEXT TO the runtime status instead of picking one and calling it "the"
     * status: an agent is legitimately `draft` (lifecycle) and `inactive`
     * (runtime) at the same instant, and the catalogue used to display one
     * vocabulary while its detail page displayed the other.
     */
    lifecycleStatus: z.string(),
    /**
     * Wired execution path (`copilots.runtime`), not the model.
     * `null` ⇒ the column is empty, which is itself why the agent cannot run.
     */
    runtime: z.string().nullable(),
    /**
     * EXECUTABLE — would the run gate accept a launch right now?
     *
     * Same rule as `POST /api/agent-ops/copilots/:id/run` and
     * `runtime-catalogue.isExecutable`: active AND every declared tool resolved.
     * Kept as an explicit field rather than left implicit in `status` so a view
     * can state it in words, and so a future widening of `status` cannot
     * silently widen what the UI calls launchable.
     */
    executable: z.boolean(),
    provider: z.string().nullable(),
    configuredModel: z.string().nullable(),
    /** Model the runner actually proved at run time. Unverified ⇒ null. */
    executedModel: z.string().nullable(),
    tools: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        enabled: z.boolean(),
        riskLevel: z.string(),
        requiresConfirmation: z.boolean(),
        /** Tool NATURE (migration 0022), fail-closed: unknown reads as `true`. */
        mutates: z.boolean(),
      }).strict()
    ),
    capabilities: z.array(z.string()),
    readOnly: z.boolean(),
    requiresHumanApproval: z.boolean(),
    lastRunAt: z.string().nullable(),
    lastRunStatus: z.string().nullable(),
    lastRunCostUsd: z.number().nullable(),
    /** Every field above that could NOT be resolved from persisted truth. */
    unavailableFields: z.array(z.string()),
    /** Declared tool ids with no registered `tools` row — why a copilot is degraded. */
    unresolvedToolIds: z.array(z.string()),
  })
  .strict()

export type AvailableAgent = z.infer<typeof AvailableAgentSchema>

// ---------------------------------------------------------------------------
// Live reads — batched, never per-agent fan-out
// ---------------------------------------------------------------------------

const inList = (ids: string[]) => ids.map((id) => `"${id}"`).join(',')

type CopilotRow = {
  id: string
  project_id: string | null
  name: string
  description: string | null
  status: string
  runtime: string | null
  model: string | null
  model_provider: string | null
  production_version_id: string | null
  latest_version_id: string | null
}

type ManifestRow = {
  id: string
  copilot_id: string
  tool_ids: string[] | null
  skills: { label?: string }[] | null
  confirmation_policy: ConfirmationPolicy | null
  forbidden_actions: string[] | null
  updated_at: string
}

type ToolRow = {
  id: string
  copilot_id: string
  name: string
  enabled: boolean | null
  risk_level: string | null
  requires_confirmation: boolean | null
  mutates: boolean | null
}

type VersionRow = {
  id: string
  copilot_id: string
  label: string | null
  stage: VersionStage | null
  manifest_id: string | null
}

type RunRow = {
  copilot_id: string
  started_at: string
  status: AgentRunStatus
  cost_usd: number | null
  resolved_model: string | null
  model_unverified: boolean | null
}

/** Only these runtimes have a wired execution path; anything else cannot run. */
const EXECUTABLE_RUNTIMES = new Set(['langgraph', 'openai-assistants', 'openai-responses', 'http'])

/** The risk vocabulary the `tools.risk_level` check constraint allows. */
const KNOWN_RISK_LEVELS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'critical'])

/** High/critical mutates by definition — same rule as `isHighRiskOrWriteCapableTool`. */
const MUTATING_RISK_LEVELS: ReadonlySet<string> = new Set(['high', 'critical'])

/** The nature signal used to judge whether a tool is provably read-only. */
export interface ToolNatureSignal {
  riskLevel: string
  /** Column default is `true` (migration 0022); only an explicit `false` proves a read. */
  mutates?: boolean
}

/**
 * The SINGLE, canonical `readOnly` derivation for a copilot, grounded in the
 * NATURE of its mounted tools (risk level + `tools.mutates`), never in the
 * confirmation policy or free-form manifest prose. Returns:
 *   - `true`   every resolved tool is provably read-only (known risk, not
 *              high/critical, explicit `mutates === false`), and a manifest exists.
 *   - `null`   nature is unknowable: no manifest, or a tool with a risk level
 *              outside the schema vocabulary. NEVER a guessed default.
 *   - `false`  a manifest exists, nature is known, and at least one tool mutates.
 *
 * Both catalog surfaces (`getAvailableAgent` for /runtime/v1 and the
 * /projects/:id/copilots route) MUST route through this so they can never
 * disagree about the same agent.
 */
export function deriveToolNatureReadOnly(
  tools: readonly ToolNatureSignal[],
  hasManifest: boolean
): boolean | null {
  if (!hasManifest) return null
  const natureUnknown = tools.some((t) => !KNOWN_RISK_LEVELS.has(t.riskLevel))
  if (natureUnknown) return null
  return tools.every((t) => !MUTATING_RISK_LEVELS.has(t.riskLevel) && t.mutates === false)
}

/** Providers the model-router can actually reach. `mistral` is declared but not wired. */
const WIRED_PROVIDERS = new Set<ModelProvider | string>(['openai', 'google', 'local'])

function firstPerKey<T>(rows: T[], key: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>()
  for (const row of rows) {
    const k = key(row)
    if (!out.has(k)) out.set(k, row) // rows arrive newest-first → first seen wins
  }
  return out
}

function nonEmpty(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

/**
 * Build one contract entry from persisted rows only.
 *
 * Every `null` below is a real absence read from the backend, never a
 * placeholder: the corresponding key is pushed into `unavailableFields` so the
 * consumer knows the difference between "no cost" and "cost not measured".
 */
function toAvailableAgent(input: {
  copilot: CopilotRow
  manifest: ManifestRow | undefined
  tools: ToolRow[]
  version: VersionRow | undefined
  lastRun: RunRow | undefined
  projectExists: boolean
}): AvailableAgent {
  const { copilot, manifest, tools, version, lastRun, projectExists } = input
  const unavailableFields: string[] = []

  const projectId = projectExists ? nonEmpty(copilot.project_id) : null
  if (projectId === null) unavailableFields.push('projectId')

  const description = nonEmpty(copilot.description)
  if (description === null) unavailableFields.push('description')

  const versionLabel = nonEmpty(version?.label ?? null)
  if (versionLabel === null) unavailableFields.push('version')

  const provider = nonEmpty(copilot.model_provider)
  if (provider === null) unavailableFields.push('provider')

  const configuredModel = nonEmpty(copilot.model)
  if (configuredModel === null) unavailableFields.push('configuredModel')

  // A run only proves the model it executed when the writer marked it verified.
  // `model_unverified` defaults to true at the DB level, so an old row or a
  // silent runner reads as unverified — surfaced as null, never trusted.
  const executedModel = lastRun && lastRun.model_unverified === false ? nonEmpty(lastRun.resolved_model) : null
  if (executedModel === null) unavailableFields.push('executedModel')

  const declaredToolIds = manifest?.tool_ids ?? []
  const registered = new Map(tools.map((t) => [t.id, t]))
  // A tool is resolved only when BOTH are true: a `tools` row exists AND the
  // runner has a handler under that row's name. Checking the row alone is what
  // let an agent read healthy in the catalogue while every call it made failed
  // with "has no registered handler" — the catalogue must agree with the runner.
  const isResolved = (id: string): boolean => {
    const row = registered.get(id)
    return row !== undefined && RUNNABLE_TOOL_NAMES.has(row.name)
  }
  const unresolvedToolIds = declaredToolIds.filter((id) => !isResolved(id))
  const resolvedTools = declaredToolIds
    .filter(isResolved)
    .map((id) => registered.get(id))
    .filter((t): t is ToolRow => t !== undefined)
    .map((t) => ({
      id: t.id,
      name: t.name,
      enabled: t.enabled === true,
      riskLevel: t.risk_level ?? 'unknown',
      requiresConfirmation: t.requires_confirmation === true,
      // Fail-closed, mirroring the column default (migration 0022): only an
      // explicit `false` — an auditable act by the tool's author — proves a
      // tool writes nothing. A NULL is a presumption, not a proof.
      mutates: t.mutates !== false,
    }))
  if (manifest === undefined) unavailableFields.push('tools')

  const capabilities = (manifest?.skills ?? [])
    .map((s) => nonEmpty(s?.label ?? null))
    .filter((label): label is string => label !== null)
  if (manifest === undefined) unavailableFields.push('capabilities')

  // `readOnly` is a claim about the NATURE of the mounted tools, never about
  // the confirmation policy applied to them. The two were conflated here: the
  // comment promised "confirmation-free AND non-mutating" while the code tested
  // `!requiresConfirmation` alone, so a genuinely mutating tool whose author had
  // simply not required a confirmation made the whole agent read "read-only".
  //
  // A tool is provably read-only only when its risk level is one the schema
  // knows, is not high/critical, AND it carries an explicit `mutates = false`.
  // When any resolved tool has a risk level outside that vocabulary its nature
  // is UNKNOWN: `readOnly` stays `false` (the type is not nullable — see
  // `runtime-catalogue.ts`) and the field is named in `unavailableFields`, which
  // is what a view must read to render "Unknown" rather than "Read-only".
  const hasManifest = manifest !== undefined
  // Canonical, nature-based derivation shared with the /projects/:id/copilots
  // catalog route (deriveToolNatureReadOnly) so the two surfaces can never
  // disagree about the same agent. `null` = unknowable → readOnly stays false
  // (the field is non-nullable) AND is named in unavailableFields, which a view
  // reads to render "Unknown" instead of "Read-only".
  const readOnlyNature = deriveToolNatureReadOnly(resolvedTools, hasManifest)
  const readOnly = readOnlyNature === true
  if (readOnlyNature === null) unavailableFields.push('readOnly')

  const requiresHumanApproval = hasManifest
    ? manifest.confirmation_policy !== 'never' || resolvedTools.some((t) => t.requiresConfirmation)
    : true // fail-closed: unknown policy ⇒ assume approval is required
  if (!hasManifest) unavailableFields.push('requiresHumanApproval')

  const lastRunAt = nonEmpty(lastRun?.started_at ?? null)
  if (lastRunAt === null) unavailableFields.push('lastRunAt')
  const lastRunStatus = nonEmpty(lastRun?.status ?? null)
  if (lastRunStatus === null) unavailableFields.push('lastRunStatus')
  const lastRunCostUsd =
    lastRun && typeof lastRun.cost_usd === 'number' && Number.isFinite(lastRun.cost_usd) ? lastRun.cost_usd : null
  if (lastRunCostUsd === null) unavailableFields.push('lastRunCostUsd')

  // --- status, derived from the checks above and nothing else -------------
  // NOT the same claim as the exported `executable` below: this one asks "is
  // there a wired execution path at all", the exported one asks "would the run
  // gate accept a launch right now". Naming them alike is how a page ended up
  // promising a launch the API refused.
  const executionPathWired =
    projectId !== null &&
    provider !== null &&
    WIRED_PROVIDERS.has(provider) &&
    configuredModel !== null &&
    versionLabel !== null &&
    hasManifest &&
    EXECUTABLE_RUNTIMES.has(copilot.runtime ?? '')

  let status: AvailableAgentStatus
  if (copilot.status === 'archived') {
    // Archived is a deliberate retirement, not a transient "not serving today".
    // It outranks every other check: an archived copilot must never surface as
    // active, and must not borrow `inactive`, which reads as "ready, just off".
    status = 'unavailable'
  } else if (!executionPathWired) {
    status = 'unavailable'
  } else if (unresolvedToolIds.length > 0 || resolvedTools.length === 0) {
    // Declared tools that resolve to nothing registered are the concrete form of
    // an "unknown stub": the copilot cannot do what it advertises.
    status = 'degraded'
  } else if (copilot.status === 'active' || version?.stage === 'production') {
    status = 'active'
  } else {
    status = 'inactive'
  }

  const runtime = nonEmpty(copilot.runtime)
  if (runtime === null) unavailableFields.push('runtime')

  return {
    copilotId: copilot.id,
    projectId,
    name: copilot.name,
    description,
    version: versionLabel,
    status,
    lifecycleStatus: copilot.status,
    runtime,
    // The run gate's rule, spelled out once: active, nothing unresolved, AND
    // runtime is langgraph (the only executable product runtime).
    executable: status === 'active' && unresolvedToolIds.length === 0 && runtime === 'langgraph',
    provider,
    configuredModel,
    executedModel,
    tools: resolvedTools,
    capabilities,
    readOnly,
    requiresHumanApproval,
    lastRunAt,
    lastRunStatus,
    lastRunCostUsd,
    unavailableFields,
    unresolvedToolIds,
  }
}

/**
 * Every agent the runtime knows about, from persisted rows only.
 *
 * Throws when the backend is unreachable — the caller surfaces an error state.
 * It must never substitute a catalogue: an empty environment returns `[]`.
 */
export async function getAvailableAgents(): Promise<AvailableAgent[]> {
  const copilots = await rest<CopilotRow[]>(
    'copilots?select=id,project_id,name,description,status,runtime,model,model_provider,production_version_id,latest_version_id&order=name'
  )
  if (copilots.length === 0) return []

  const ids = copilots.map((c) => c.id)
  const versionIds = copilots
    .map((c) => c.production_version_id ?? c.latest_version_id)
    .filter((v): v is string => typeof v === 'string' && v.length > 0)

  const [tools, versions, runs, projects] = await Promise.all([
    rest<ToolRow[]>(
      `tools?select=id,copilot_id,name,enabled,risk_level,requires_confirmation,mutates&copilot_id=in.(${inList(ids)})`
    ),
    versionIds.length > 0
      ? rest<VersionRow[]>(
          `copilot_versions?select=id,copilot_id,label,stage,manifest_id&id=in.(${inList(versionIds)})`
        )
      : Promise.resolve([]),
    rest<RunRow[]>(
      // Evaluation rows excluded: the test runner (029) and the benchmark
      // runner (030) each write one agent_runs row per case/task on the direct
      // path, and this read feeds an agent's LAST RUN — the evidence its
      // runtime status rests on. Neither is an operator run, so letting one
      // become "the last run" would restate authoring activity as production
      // truth.
      `agent_runs?select=copilot_id,started_at,status,cost_usd,resolved_model,model_unverified&copilot_id=in.(${inList(ids)})&${NON_EVALUATION_RUN_FILTER}&order=started_at.desc`
    ),
    rest<{ id: string }[]>('projects?select=id'),
  ])

  const manifestIds = [
    ...new Set(
      versions
        .map((v) => v.manifest_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
    ),
  ]
  const manifests =
    manifestIds.length > 0
      ? await rest<ManifestRow[]>(
          `manifests?select=id,copilot_id,tool_ids,skills,confirmation_policy,forbidden_actions,updated_at&id=in.(${inList(manifestIds)})`
        )
      : []

  const manifestById = new Map(manifests.map((m) => [m.id, m]))
  const versionById = new Map(versions.map((v) => [v.id, v]))
  const manifestByCopilot = new Map<string, ManifestRow>()
  for (const copilot of copilots) {
    const versionId = copilot.production_version_id ?? copilot.latest_version_id
    const manifestId = versionId ? versionById.get(versionId)?.manifest_id : null
    if (!manifestId) continue
    const manifest = manifestById.get(manifestId)
    if (manifest) manifestByCopilot.set(copilot.id, manifest)
  }
  const lastRunByCopilot = firstPerKey(runs, (r) => r.copilot_id)
  const projectIds = new Set(projects.map((p) => p.id))
  const toolsByCopilot = new Map<string, ToolRow[]>()
  for (const tool of tools) {
    const bucket = toolsByCopilot.get(tool.copilot_id)
    if (bucket) bucket.push(tool)
    else toolsByCopilot.set(tool.copilot_id, [tool])
  }

  return copilots.map((copilot) => {
    const versionId = copilot.production_version_id ?? copilot.latest_version_id
    return AvailableAgentSchema.parse(
      toAvailableAgent({
        copilot,
        manifest: manifestByCopilot.get(copilot.id),
        tools: toolsByCopilot.get(copilot.id) ?? [],
        version: versionId ? versionById.get(versionId) : undefined,
        lastRun: lastRunByCopilot.get(copilot.id),
        projectExists: copilot.project_id !== null && projectIds.has(copilot.project_id),
      })
    )
  })
}

/** One agent by copilot id, or `undefined` when no persisted row carries that id. */
export async function getAvailableAgent(copilotId: string): Promise<AvailableAgent | undefined> {
  const agents = await getAvailableAgents()
  return agents.find((a) => a.copilotId === copilotId)
}

/**
 * Counters derived from the SAME list the catalogue serves.
 *
 * This is the whole point: a metric computed from a second, independent query
 * can silently drift from what the list shows — and a metric computed from
 * manifests or roster files counts agents that were never provisioned. Passing
 * the already-resolved array in makes the two structurally incapable of
 * disagreeing.
 *
 * `withProvenExecutedModel` is deliberately not called "verified agents": it
 * counts the agents whose LAST RUN proved the model it executed. Every other
 * agent is simply unproven, which is a different claim from "wrong".
 */
export function summarizeAvailableAgents(agents: AvailableAgent[]): {
  total: number
  active: number
  inactive: number
  degraded: number
  unavailable: number
  withProvenExecutedModel: number
} {
  const by = (s: AvailableAgentStatus) => agents.filter((a) => a.status === s).length
  return {
    total: agents.length,
    active: by('active'),
    inactive: by('inactive'),
    degraded: by('degraded'),
    unavailable: by('unavailable'),
    withProvenExecutedModel: agents.filter((a) => a.executedModel !== null).length,
  }
}

// `RawRow` is exported-adjacent only for the transport typing above; keep the
// module surface to the contract + the two readers + the summary.
export type { RawRow }
