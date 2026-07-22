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

import { FINANCE_TOOL_HANDLERS } from './finance/tools'
import { TRADING_TOOL_HANDLERS } from './market/tools'
import { pgrest } from './postgrest'
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

const RUNNABLE_TOOL_NAMES: ReadonlySet<string> = new Set<string>([
  ...NATIVE_TOOL_NAMES,
  ...Object.keys(TRADING_TOOL_HANDLERS),
  ...Object.keys(FINANCE_TOOL_HANDLERS),
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
    status: z.enum(AVAILABLE_AGENT_STATUSES),
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
}

type VersionRow = { id: string; copilot_id: string; label: string | null; stage: VersionStage | null }

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
    }))
  if (manifest === undefined) unavailableFields.push('tools')

  const capabilities = (manifest?.skills ?? [])
    .map((s) => nonEmpty(s?.label ?? null))
    .filter((label): label is string => label !== null)
  if (manifest === undefined) unavailableFields.push('capabilities')

  // `readOnly` is a claim about the mounted tools, so it can only be asserted
  // when a manifest exists AND every resolved tool is confirmation-free and
  // non-mutating. With no manifest we cannot claim read-only — we say false and
  // flag the field rather than assert a reassuring default.
  const hasManifest = manifest !== undefined
  const readOnly = hasManifest && resolvedTools.every((t) => !t.requiresConfirmation)
  if (!hasManifest) unavailableFields.push('readOnly')

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
  const executable =
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
  } else if (!executable) {
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

  return {
    copilotId: copilot.id,
    projectId,
    name: copilot.name,
    description,
    version: versionLabel,
    status,
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

  const [manifests, tools, versions, runs, projects] = await Promise.all([
    rest<ManifestRow[]>(
      `manifests?select=copilot_id,tool_ids,skills,confirmation_policy,forbidden_actions,updated_at&copilot_id=in.(${inList(ids)})&order=updated_at.desc`
    ),
    rest<ToolRow[]>(
      `tools?select=id,copilot_id,name,enabled,risk_level,requires_confirmation&copilot_id=in.(${inList(ids)})`
    ),
    versionIds.length > 0
      ? rest<VersionRow[]>(`copilot_versions?select=id,copilot_id,label,stage&id=in.(${inList(versionIds)})`)
      : Promise.resolve([]),
    rest<RunRow[]>(
      `agent_runs?select=copilot_id,started_at,status,cost_usd,resolved_model,model_unverified&copilot_id=in.(${inList(ids)})&order=started_at.desc`
    ),
    rest<{ id: string }[]>('projects?select=id'),
  ])

  const manifestByCopilot = firstPerKey(manifests, (m) => m.copilot_id)
  const lastRunByCopilot = firstPerKey(runs, (r) => r.copilot_id)
  const versionById = new Map(versions.map((v) => [v.id, v]))
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
