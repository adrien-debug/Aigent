/**
 * Agent Mission Control — data layer (server only).
 *
 * LIVE ONLY. The single source is the gpu1 PostgREST perimeter (base `aigent`).
 * There is NO mock fallback: if the backend is not configured or unreachable,
 * every getter throws and the /admin error boundary shows a retry — the app
 * never fabricates data.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 *
 * Never import this module from a client component: it reads the service role
 * key. Pages (server components) fetch and pass plain props.
 */
import 'server-only'

import type {
  AgentManifest,
  AgentRun,
  AgentRunStep,
  BenchmarkResult,
  BenchmarkRun,
  BenchmarkSuite,
  Copilot,
  CopilotVersion,
  Project,
  PromotionGate,
  RegistryWarning,
  ReplayComparison,
  ShadowExperiment,
  TestCase,
  TestResult,
  TestRun,
  TestSuite,
  ToolCall,
  ToolDefinition,
} from './types'

// ---------------------------------------------------------------------------
// PostgREST minimal client (fetch, service_role, zero deps) — fail-closed
// ---------------------------------------------------------------------------

function requireBackend(): { base: string; key: string } {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error(
      'Agent Mission Control is live-only: set AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY. No mock dataset is bundled.'
    )
  }
  return { base, key }
}

async function rest<T>(pathAndQuery: string): Promise<T> {
  const { base, key } = requireBackend()
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** snake_case → camelCase (top-level only; jsonb payloads are already camelCase). */
function camelRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())] = v
  }
  return out as T
}

const camelRows = <T>(rows: Record<string, unknown>[]): T[] => rows.map((r) => camelRow<T>(r))

type RawRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Getters — live PostgREST, async
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  return camelRows<Project>(await rest<RawRow[]>('projects?select=*&order=created_at'))
}

export async function getProject(id: string): Promise<Project | undefined> {
  return camelRows<Project>(await rest<RawRow[]>(`projects?select=*&id=eq.${id}`))[0]
}

export async function getCopilots(): Promise<Copilot[]> {
  return camelRows<Copilot>(await rest<RawRow[]>('copilots?select=*&order=name'))
}

export async function getCopilot(id: string): Promise<Copilot | undefined> {
  return camelRows<Copilot>(await rest<RawRow[]>(`copilots?select=*&id=eq.${id}`))[0]
}

export async function getVersionsForCopilot(copilotId: string): Promise<CopilotVersion[]> {
  return camelRows<CopilotVersion>(
    await rest<RawRow[]>(`copilot_versions?select=*&copilot_id=eq.${copilotId}&order=created_at.desc`)
  )
}

export async function getVersion(id: string): Promise<CopilotVersion | undefined> {
  return camelRows<CopilotVersion>(await rest<RawRow[]>(`copilot_versions?select=*&id=eq.${id}`))[0]
}

export async function getManifestForCopilot(copilotId: string): Promise<AgentManifest | undefined> {
  return camelRows<AgentManifest>(
    await rest<RawRow[]>(`manifests?select=*&copilot_id=eq.${copilotId}&order=updated_at.desc&limit=1`)
  )[0]
}

export async function getToolsForCopilot(copilotId: string): Promise<ToolDefinition[]> {
  const rows = await rest<RawRow[]>(`tools?select=*&copilot_id=eq.${copilotId}&order=risk_level,name`)
  // copilot_id is a DB column, absent from ToolDefinition — drop it.
  return camelRows<ToolDefinition>(
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'copilot_id')))
  )
}

export async function getTestSuitesForCopilot(copilotId: string): Promise<TestSuite[]> {
  const rows = await rest<RawRow[]>(`test_suites?select=*,test_cases(id)&copilot_id=eq.${copilotId}&order=name`)
  return rows.map((r) => {
    const { test_cases, ...rest_ } = r as RawRow & { test_cases: { id: string }[] }
    const suite = camelRow<TestSuite>(rest_)
    suite.caseIds = (test_cases ?? []).map((c) => c.id)
    return suite
  })
}

export async function getTestCasesForSuite(suiteId: string): Promise<TestCase[]> {
  return camelRows<TestCase>(await rest<RawRow[]>(`test_cases?select=*&suite_id=eq.${suiteId}&order=id`))
}

export async function getTestRunsForCopilot(copilotId: string): Promise<TestRun[]> {
  const rows = await rest<RawRow[]>(
    `test_runs?select=*,test_results(id)&copilot_id=eq.${copilotId}&order=started_at.desc`
  )
  return rows.map((r) => {
    const { test_results, ...rest_ } = r as RawRow & { test_results: { id: string }[] }
    const run = camelRow<TestRun>(rest_)
    run.resultIds = (test_results ?? []).map((x) => x.id)
    return run
  })
}

export async function getTestResultsForRun(runId: string): Promise<TestResult[]> {
  return camelRows<TestResult>(await rest<RawRow[]>(`test_results?select=*&run_id=eq.${runId}&order=id`))
}

export async function getRunsForCopilot(copilotId: string): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&copilot_id=eq.${copilotId}&order=started_at.desc`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = camelRow<AgentRun>(rest_)
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

export async function getRun(id: string): Promise<AgentRun | undefined> {
  const rows = await rest<RawRow[]>(`agent_runs?select=*,agent_run_steps(id)&id=eq.${id}`)
  if (!rows[0]) return undefined
  const { agent_run_steps, ...rest_ } = rows[0] as RawRow & { agent_run_steps: { id: string }[] }
  const run = camelRow<AgentRun>(rest_)
  run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
  return run
}

export async function getRecentRuns(limit = 30): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(`agent_runs?select=*,agent_run_steps(id)&order=started_at.desc&limit=${limit}`)
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = camelRow<AgentRun>(rest_)
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/** Traces for a project: the runs of ITS copilots (per-project Traces menu). */
export async function getRecentRunsForProject(projectId: string, limit = 30): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&project_id=eq.${encodeURIComponent(projectId)}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = camelRow<AgentRun>(rest_)
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

export async function getStepsForRun(runId: string): Promise<AgentRunStep[]> {
  return camelRows<AgentRunStep>(await rest<RawRow[]>(`agent_run_steps?select=*&run_id=eq.${runId}&order=index`))
}

export async function getToolCallsForRun(runId: string): Promise<ToolCall[]> {
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=eq.${runId}&order=id`))
}

export async function getBenchmarkSuitesForCopilot(copilotId: string): Promise<BenchmarkSuite[]> {
  return camelRows<BenchmarkSuite>(
    await rest<RawRow[]>(`benchmark_suites?select=*&copilot_id=eq.${copilotId}&order=name`)
  )
}

export async function getBenchmarkRunsForSuite(suiteId: string): Promise<BenchmarkRun[]> {
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=eq.${suiteId}&order=started_at.desc`)
  )
}

export async function getBenchmarkResultForRun(runId: string): Promise<BenchmarkResult | undefined> {
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=eq.${runId}`))[0]
}

export async function getReplayComparisonsForCopilot(copilotId: string): Promise<ReplayComparison[]> {
  return camelRows<ReplayComparison>(
    await rest<RawRow[]>(`replay_comparisons?select=*&copilot_id=eq.${copilotId}&order=created_at.desc`)
  )
}

export async function getShadowExperimentsForCopilot(copilotId: string): Promise<ShadowExperiment[]> {
  return camelRows<ShadowExperiment>(
    await rest<RawRow[]>(`shadow_experiments?select=*&copilot_id=eq.${copilotId}&order=started_at.desc`)
  )
}

export async function getPromotionGateForCopilot(copilotId: string): Promise<PromotionGate | undefined> {
  return camelRows<PromotionGate>(
    await rest<RawRow[]>(`promotion_gates?select=*&copilot_id=eq.${copilotId}&order=last_evaluated_at.desc&limit=1`)
  )[0]
}

export async function getRecentWarnings(limit = 6): Promise<RegistryWarning[]> {
  return camelRows<RegistryWarning>(
    await rest<RawRow[]>(`registry_warnings?select=*&order=occurred_at.desc&limit=${limit}`)
  )
}

export interface RegistryKpis {
  totalCopilots: number
  activeCopilots: number
  avgTestPassRate: number
  runsLast24h: number
  totalCostLast24hUsd: number
  openWarnings: number
}

export async function getRegistryKpis(): Promise<RegistryKpis> {
  const copilots = await getCopilots()
  const measured = copilots.filter((c) => c.health.testPassRate > 0)
  return {
    totalCopilots: copilots.length,
    activeCopilots: copilots.filter((c) => c.status === 'active').length,
    avgTestPassRate:
      measured.length > 0 ? measured.reduce((s, c) => s + c.health.testPassRate, 0) / measured.length : 0,
    runsLast24h: copilots.reduce((s, c) => s + c.health.runsLast24h, 0),
    totalCostLast24hUsd: copilots.reduce((s, c) => s + c.health.costLast24hUsd, 0),
    openWarnings: copilots.reduce((s, c) => s + c.health.openWarnings, 0),
  }
}

// Static UI labels (not data) — re-export so pages import from one place.
export { AGENT_RUNTIME_LABELS, MODEL_PROVIDER_LABELS } from './labels'
