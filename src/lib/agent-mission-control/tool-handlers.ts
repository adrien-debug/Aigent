/**
 * Agent Mission Control — tool handlers (server only).
 *
 * Real execution of an agent's declared tools. Each handler reads live data
 * through the data-layer getters (data.ts, which talks to the gpu1 PostgREST
 * perimeter) and returns a compact, JSON-serializable result that the runner
 * feeds back to the model as the tool result — plus a human summary for the
 * timeline step detail.
 *
 * Handlers are keyed by MANIFEST TOOL NAME (e.g. 'read_copilot_summary') in the
 * TOOL_HANDLERS registry, matching the `proposedTools[].name` of a copilot's
 * manifest (see agent-builder-copilot.ts).
 *
 * SAFETY CONTRACT:
 *   - Handlers NEVER throw. On any error they return `{ ok:false, data:{error},
 *     summary }`. The runner never has to try/catch a handler.
 *   - The V1 read handlers are strictly read-only (they only call `get*`
 *     getters, never any write path).
 *   - The single write tool, `draft_copilot_spec`, NEVER persists anything: it
 *     only returns a proposed spec object. Any confirmation/gating/persistence
 *     is enforced elsewhere (the runner, via the tool's requiresConfirmation
 *     flag) — this handler is a pure proposal generator.
 *
 * data.ts and postgrest.ts are 'server-only', so this module is too and must
 * only be imported server-side (the runner). Never from a client component.
 */
import 'server-only'

import { buildCopilotDraft } from '../../langgraph/draft-spec.mjs'
import { TRADING_TOOL_HANDLERS } from './market/tools'
import {
  getCopilot,
  getCopilots,
  getProject,
  getProjects,
  getRecentRuns,
  getRunsForCopilot,
  getToolsForCopilot,
} from './data'
import type { AgentRun, Copilot, Project, ToolDefinition } from './types'

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

interface ToolHandlerContext {
  /** The copilot this run belongs to (for scoping/defaults). */
  copilotId: string
}

export interface ToolHandlerResult {
  ok: boolean
  /** Compact JSON-serializable result fed back to the model as the tool result. */
  data: unknown
  /** Human summary for the timeline step detail. */
  summary: string
}

/** A read-only or gated tool handler. Never throws — returns ok:false on error. */
export type ToolHandler = (argsJson: string, ctx: ToolHandlerContext) => Promise<ToolHandlerResult>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Defensive JSON parse — never throws, always yields a plain object. */
function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(argsJson || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

/** Read an optional string arg, trimmed; undefined/empty → undefined. */
function optString(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t.length > 0 ? t : undefined
}

function parseNumericArg(v: unknown): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') return Number(v)
  return Number.NaN
}

/** Read an optional positive integer arg, clamped to [1, cap]; else fallback. */
function optLimit(args: Record<string, unknown>, key: string, fallback: number, cap: number): number {
  const n = parseNumericArg(args[key])
  if (!Number.isFinite(n)) return fallback
  return Math.max(1, Math.min(cap, Math.floor(n)))
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** Uniform failure result. */
function fail(what: string, e: unknown): ToolHandlerResult {
  const msg = errorMessage(e)
  return { ok: false, data: { error: msg }, summary: `${what} failed: ${msg}` }
}

// ---------------------------------------------------------------------------
// Compact projections — only the fields the model needs, no giant payloads.
// ---------------------------------------------------------------------------

function projectSummary(p: Project) {
  return {
    id: p.id,
    name: p.name,
    platform: p.platform,
    repoFullName: p.repoFullName ?? null,
  }
}

function copilotSummary(c: Copilot) {
  return {
    id: c.id,
    name: c.name,
    // Derived display status (data.ts): reflects a served production version
    // even when the stored `status` column still reads draft.
    status: c.displayStatus ?? c.status,
    model: c.model,
    modelProvider: c.modelProvider,
    runtime: c.runtime,
    health: {
      // Run-backed via the enriched getters — the stale zero blob is overwritten.
      testPassRate: c.health.testPassRate,
      benchmarkScore: c.health.benchmarkScore,
      runsLast24h: c.health.runsLast24h,
    },
  }
}

function runSummary(r: AgentRun) {
  return {
    id: r.id,
    status: r.status,
    startedAt: r.startedAt,
    latencyMs: r.latencyMs,
    costUsd: r.costUsd,
    inputSummary: r.inputSummary,
    outputSummary: r.outputSummary,
  }
}

function toolPermissionSummary(t: ToolDefinition) {
  return {
    name: t.name,
    riskLevel: t.riskLevel,
    enabled: t.enabled,
    requiresConfirmation: t.requiresConfirmation,
    provider: t.provider,
  }
}

// ---------------------------------------------------------------------------
// 1. read_project_summary — args { projectId?: string }
// ---------------------------------------------------------------------------

const readProjectSummary: ToolHandler = async (argsJson) => {
  try {
    const args = parseArgs(argsJson)
    const projectId = optString(args, 'projectId')

    if (projectId) {
      const project = await getProject(projectId)
      if (!project) {
        return { ok: false, data: { error: `Project not found: ${projectId}` }, summary: `Project ${projectId} not found` }
      }
      return {
        ok: true,
        data: { project: projectSummary(project) },
        summary: `Read project "${project.name}"`,
      }
    }

    const projects = await getProjects()
    return {
      ok: true,
      data: { count: projects.length, projects: projects.map(projectSummary) },
      summary: `${projects.length} project${projects.length === 1 ? '' : 's'}`,
    }
  } catch (e) {
    return fail('read_project_summary', e)
  }
}

// ---------------------------------------------------------------------------
// 2. read_copilot_summary — args { copilotId?: string }, default ctx.copilotId
// ---------------------------------------------------------------------------

const readCopilotSummary: ToolHandler = async (argsJson, ctx) => {
  try {
    const args = parseArgs(argsJson)
    const copilotId = optString(args, 'copilotId') ?? ctx.copilotId

    if (copilotId) {
      const copilot = await getCopilot(copilotId)
      if (!copilot) {
        return { ok: false, data: { error: `Copilot not found: ${copilotId}` }, summary: `Copilot ${copilotId} not found` }
      }
      return {
        ok: true,
        data: { copilot: copilotSummary(copilot) },
        summary: `Read copilot "${copilot.name}"`,
      }
    }

    // No id and no context → list all copilots (summarized).
    const copilots = await getCopilots()
    return {
      ok: true,
      data: { count: copilots.length, copilots: copilots.map(copilotSummary) },
      summary: `${copilots.length} copilot${copilots.length === 1 ? '' : 's'}`,
    }
  } catch (e) {
    return fail('read_copilot_summary', e)
  }
}

// ---------------------------------------------------------------------------
// 3. read_recent_runs — args { copilotId?: string, limit?: number }
//    default copilotId = ctx.copilotId, limit = 5 (cap 20)
// ---------------------------------------------------------------------------

const readRecentRuns: ToolHandler = async (argsJson, ctx) => {
  try {
    const args = parseArgs(argsJson)
    const copilotId = optString(args, 'copilotId') ?? ctx.copilotId
    const limit = optLimit(args, 'limit', 5, 20)

    const runs = copilotId ? await getRunsForCopilot(copilotId) : await getRecentRuns(limit)
    const sliced = runs.slice(0, limit)

    return {
      ok: true,
      data: {
        copilotId: copilotId ?? null,
        count: sliced.length,
        runs: sliced.map(runSummary),
      },
      summary: `${sliced.length} recent run${sliced.length === 1 ? '' : 's'}`,
    }
  } catch (e) {
    return fail('read_recent_runs', e)
  }
}

// ---------------------------------------------------------------------------
// 4. read_tool_permissions — args { copilotId?: string }, default ctx.copilotId
// ---------------------------------------------------------------------------

const readToolPermissions: ToolHandler = async (argsJson, ctx) => {
  try {
    const args = parseArgs(argsJson)
    const copilotId = optString(args, 'copilotId') ?? ctx.copilotId

    if (!copilotId) {
      return {
        ok: false,
        data: { error: 'No copilotId provided and no run context copilot.' },
        summary: 'read_tool_permissions failed: no copilot id',
      }
    }

    const tools = await getToolsForCopilot(copilotId)
    const needConfirm = tools.filter((t) => t.requiresConfirmation).length

    const toolLabel = tools.length === 1 ? 'tool' : 'tools'
    const requireLabel = needConfirm === 1 ? 'requires' : 'require'

    return {
      ok: true,
      data: {
        copilotId,
        count: tools.length,
        requiresConfirmationCount: needConfirm,
        tools: tools.map(toolPermissionSummary),
      },
      summary: `${tools.length} ${toolLabel} (${needConfirm} ${requireLabel} confirmation)`,
    }
  } catch (e) {
    return fail('read_tool_permissions', e)
  }
}

// ---------------------------------------------------------------------------
// 5. draft_copilot_spec — GATED write tool.
//
// IMPORTANT: this handler NEVER persists anything. It returns a structured
// DRAFT proposal only. Blocking / confirmation / actual materialization is
// enforced elsewhere (the runner honors the tool's requiresConfirmation flag
// before this even runs, and a human confirms before any write path is called).
// This function is a pure proposal generator — no DB writes, no side effects.
// ---------------------------------------------------------------------------

const draftCopilotSpec: ToolHandler = async (argsJson) => {
  try {
    const args = parseArgs(argsJson)
    // Shared builder (draft-spec.mjs) — same draft shape as the LangGraph path,
    // so the two can never diverge. Pure, never persists.
    const draft = buildCopilotDraft({
      name: optString(args, 'name'),
      description: optString(args, 'description'),
      runtime: optString(args, 'runtime'),
      model: optString(args, 'model'),
    })
    return {
      ok: true,
      data: draft,
      summary: `Drafted a spec proposal for "${draft.name}" (not persisted — awaiting human confirmation)`,
    }
  } catch (e) {
    return fail('draft_copilot_spec', e)
  }
}

// ---------------------------------------------------------------------------
// Registry — keyed by manifest tool name.
// ---------------------------------------------------------------------------

export const TOOL_HANDLERS: Record<string, ToolHandler> = {
  read_project_summary: readProjectSummary,
  read_copilot_summary: readCopilotSummary,
  read_recent_runs: readRecentRuns,
  read_tool_permissions: readToolPermissions,
  draft_copilot_spec: draftCopilotSpec,
  // AIG-TRADE-001 — the read-only market tools the trading gamme calls. Each
  // trading handler is `(argsJson) => {ok,data,summary}` (ctx unused, they are
  // stateless reads); adapted to the ToolHandler shape here so the runner can
  // resolve them by manifest tool name exactly like the native handlers.
  ...Object.fromEntries(
    Object.entries(TRADING_TOOL_HANDLERS).map(([name, fn]) => [
      name,
      (async (argsJson: string) => fn(argsJson)) as ToolHandler,
    ]),
  ),
}
