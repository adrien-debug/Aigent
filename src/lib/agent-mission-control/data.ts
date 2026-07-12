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

import { camelRow, camelRows, pgrest } from './postgrest'
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

// PostgREST transport + case conversion come from the shared server-only client.
const rest = <T>(pathAndQuery: string): Promise<T> => pgrest<T>('GET', pathAndQuery)

type RawRow = Record<string, unknown>

// ---------------------------------------------------------------------------
// Getters — live PostgREST, async
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  return camelRows<Project>(await rest<RawRow[]>('projects?select=*&order=created_at'))
}

export async function getProject(id: string): Promise<Project | undefined> {
  return camelRows<Project>(await rest<RawRow[]>(`projects?select=*&id=eq.${encodeURIComponent(id)}`))[0]
}

export async function getCopilots(): Promise<Copilot[]> {
  return camelRows<Copilot>(await rest<RawRow[]>('copilots?select=*&order=name'))
}

export async function getCopilot(id: string): Promise<Copilot | undefined> {
  return camelRows<Copilot>(await rest<RawRow[]>(`copilots?select=*&id=eq.${encodeURIComponent(id)}`))[0]
}

export async function getVersionsForCopilot(copilotId: string): Promise<CopilotVersion[]> {
  return camelRows<CopilotVersion>(
    await rest<RawRow[]>(`copilot_versions?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=created_at.desc`)
  )
}

export async function getVersion(id: string): Promise<CopilotVersion | undefined> {
  return camelRows<CopilotVersion>(await rest<RawRow[]>(`copilot_versions?select=*&id=eq.${encodeURIComponent(id)}`))[0]
}

export async function getManifestForCopilot(copilotId: string): Promise<AgentManifest | undefined> {
  return camelRows<AgentManifest>(
    await rest<RawRow[]>(`manifests?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=updated_at.desc&limit=1`)
  )[0]
}

export async function getToolsForCopilot(copilotId: string): Promise<ToolDefinition[]> {
  const rows = await rest<RawRow[]>(`tools?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=risk_level,name`)
  // copilot_id is a DB column, absent from ToolDefinition — drop it.
  return camelRows<ToolDefinition>(
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'copilot_id')))
  )
}

export async function getTestSuitesForCopilot(copilotId: string): Promise<TestSuite[]> {
  const rows = await rest<RawRow[]>(`test_suites?select=*,test_cases(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=name`)
  return rows.map((r) => {
    const { test_cases, ...rest_ } = r as RawRow & { test_cases: { id: string }[] }
    const suite = camelRow<TestSuite>(rest_)
    suite.caseIds = (test_cases ?? []).map((c) => c.id)
    return suite
  })
}

export async function getTestCasesForSuite(suiteId: string): Promise<TestCase[]> {
  return camelRows<TestCase>(await rest<RawRow[]>(`test_cases?select=*&suite_id=eq.${encodeURIComponent(suiteId)}&order=id`))
}

export async function getTestRunsForCopilot(copilotId: string): Promise<TestRun[]> {
  const rows = await rest<RawRow[]>(
    `test_runs?select=*,test_results(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc`
  )
  return rows.map((r) => {
    const { test_results, ...rest_ } = r as RawRow & { test_results: { id: string }[] }
    const run = camelRow<TestRun>(rest_)
    run.resultIds = (test_results ?? []).map((x) => x.id)
    return run
  })
}

export async function getTestResultsForRun(runId: string): Promise<TestResult[]> {
  return camelRows<TestResult>(await rest<RawRow[]>(`test_results?select=*&run_id=eq.${encodeURIComponent(runId)}&order=id`))
}

/**
 * Runs for a copilot, newest first. Bounded by `limit` (default 50) so this
 * stays a single fast PostgREST round trip regardless of how much traffic a
 * copilot has accumulated — callers that need the true full history should
 * paginate explicitly rather than removing the cap.
 */
export async function getRunsForCopilot(copilotId: string, limit = 50): Promise<AgentRun[]> {
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = camelRow<AgentRun>(rest_)
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
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
  return camelRows<AgentRunStep>(await rest<RawRow[]>(`agent_run_steps?select=*&run_id=eq.${encodeURIComponent(runId)}&order=index`))
}

export async function getToolCallsForRun(runId: string): Promise<ToolCall[]> {
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=eq.${encodeURIComponent(runId)}&order=id`))
}

/**
 * Tool calls for a batch of runs — ONE PostgREST round trip via `run_id=in.(...)`
 * instead of one fetch per run. Use this whenever you need tool calls across a
 * run list (e.g. a runs table); use `getToolCallsForRun` for a single run.
 */
export async function getToolCallsForRuns(runIds: string[]): Promise<ToolCall[]> {
  if (runIds.length === 0) return []
  const ids = runIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=in.(${ids})&order=id`))
}

export async function getBenchmarkSuitesForCopilot(copilotId: string): Promise<BenchmarkSuite[]> {
  return camelRows<BenchmarkSuite>(
    await rest<RawRow[]>(`benchmark_suites?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=name`)
  )
}

export async function getBenchmarkRunsForSuite(suiteId: string): Promise<BenchmarkRun[]> {
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=eq.${encodeURIComponent(suiteId)}&order=started_at.desc`)
  )
}

/**
 * Benchmark runs across a batch of suites — ONE PostgREST round trip via
 * `suite_id=in.(...)` instead of one fetch per suite. Use this when scanning
 * all of a copilot's suites at once (e.g. the overview's best-candidate scan);
 * use `getBenchmarkRunsForSuite` for a single suite.
 */
export async function getBenchmarkRunsForSuites(suiteIds: string[]): Promise<BenchmarkRun[]> {
  if (suiteIds.length === 0) return []
  const ids = suiteIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=in.(${ids})&order=started_at.desc`)
  )
}

export async function getBenchmarkResultForRun(runId: string): Promise<BenchmarkResult | undefined> {
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=eq.${encodeURIComponent(runId)}`))[0]
}

/**
 * Benchmark results across a batch of runs — ONE PostgREST round trip via
 * `run_id=in.(...)` instead of one fetch per run. Use `getBenchmarkResultForRun`
 * for a single run.
 */
export async function getBenchmarkResultsForRuns(runIds: string[]): Promise<BenchmarkResult[]> {
  if (runIds.length === 0) return []
  const ids = runIds.map((id) => encodeURIComponent(id)).join(',')
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=in.(${ids})`))
}

export async function getReplayComparisonsForCopilot(copilotId: string): Promise<ReplayComparison[]> {
  return camelRows<ReplayComparison>(
    await rest<RawRow[]>(`replay_comparisons?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=created_at.desc`)
  )
}

export async function getShadowExperimentsForCopilot(copilotId: string): Promise<ShadowExperiment[]> {
  return camelRows<ShadowExperiment>(
    await rest<RawRow[]>(`shadow_experiments?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=started_at.desc`)
  )
}

export async function getPromotionGateForCopilot(copilotId: string): Promise<PromotionGate | undefined> {
  return camelRows<PromotionGate>(
    await rest<RawRow[]>(`promotion_gates?select=*&copilot_id=eq.${encodeURIComponent(copilotId)}&order=last_evaluated_at.desc&limit=1`)
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
