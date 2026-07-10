/**
 * Agent Mission Control — couche data (serveur uniquement).
 *
 * Même API que les helpers mock, en async. Source réelle : PostgREST du
 * périmètre gpu1 (base `aigent`), sélectionnée par AMC_DATA_SOURCE=gpu1 ;
 * toute autre valeur (ou l'absence d'env) retombe sur le dataset mock —
 * l'app reste utilisable sans backend.
 *
 * Ne jamais importer ce module depuis un composant client : il lit
 * SUPABASE_SERVICE_ROLE_KEY. Les pages (server components) fetchent et
 * passent des props.
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
import * as mock from './mock-data'

const isGpu1Backed = () =>
  process.env.AMC_DATA_SOURCE === 'gpu1' &&
  !!process.env.AMC_SUPABASE_URL &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY

// ---------------------------------------------------------------------------
// PostgREST minimal client (fetch, service_role, zéro dépendance)
// ---------------------------------------------------------------------------

async function rest<T>(pathAndQuery: string): Promise<T> {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${key}` },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${pathAndQuery}: ${(await res.text()).slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** snake_case → camelCase (top-level uniquement ; les payloads jsonb sont déjà camelCase). */
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
// Helpers — même contrat que mock-data, en async
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  if (!isGpu1Backed()) return mock.getProjects()
  return camelRows<Project>(await rest<RawRow[]>('projects?select=*&order=created_at'))
}

export async function getProject(id: string): Promise<Project | undefined> {
  if (!isGpu1Backed()) return mock.getProject(id)
  return camelRows<Project>(await rest<RawRow[]>(`projects?select=*&id=eq.${id}`))[0]
}

export async function getCopilots(): Promise<Copilot[]> {
  if (!isGpu1Backed()) return mock.getCopilots()
  return camelRows<Copilot>(await rest<RawRow[]>('copilots?select=*&order=name'))
}

export async function getCopilot(id: string): Promise<Copilot | undefined> {
  if (!isGpu1Backed()) return mock.getCopilot(id)
  return camelRows<Copilot>(await rest<RawRow[]>(`copilots?select=*&id=eq.${id}`))[0]
}

export async function getVersionsForCopilot(copilotId: string): Promise<CopilotVersion[]> {
  if (!isGpu1Backed()) return mock.getVersionsForCopilot(copilotId)
  return camelRows<CopilotVersion>(
    await rest<RawRow[]>(`copilot_versions?select=*&copilot_id=eq.${copilotId}&order=created_at.desc`)
  )
}

export async function getVersion(id: string): Promise<CopilotVersion | undefined> {
  if (!isGpu1Backed()) return mock.getVersion(id)
  return camelRows<CopilotVersion>(await rest<RawRow[]>(`copilot_versions?select=*&id=eq.${id}`))[0]
}

export async function getManifestForCopilot(copilotId: string): Promise<AgentManifest | undefined> {
  if (!isGpu1Backed()) return mock.getManifestForCopilot(copilotId)
  return camelRows<AgentManifest>(
    await rest<RawRow[]>(`manifests?select=*&copilot_id=eq.${copilotId}&order=updated_at.desc&limit=1`)
  )[0]
}

export async function getToolsForCopilot(copilotId: string): Promise<ToolDefinition[]> {
  if (!isGpu1Backed()) return mock.getToolsForCopilot(copilotId)
  const rows = await rest<RawRow[]>(`tools?select=*&copilot_id=eq.${copilotId}&order=risk_level,name`)
  // copilot_id est une colonne DB, absente du type ToolDefinition — on la retire.
  return camelRows<ToolDefinition>(
    rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'copilot_id')))
  )
}

export async function getTestSuitesForCopilot(copilotId: string): Promise<TestSuite[]> {
  if (!isGpu1Backed()) return mock.getTestSuitesForCopilot(copilotId)
  const rows = await rest<RawRow[]>(
    `test_suites?select=*,test_cases(id)&copilot_id=eq.${copilotId}&order=name`
  )
  return rows.map((r) => {
    const { test_cases, ...rest_ } = r as RawRow & { test_cases: { id: string }[] }
    const suite = camelRow<TestSuite>(rest_)
    suite.caseIds = (test_cases ?? []).map((c) => c.id)
    return suite
  })
}

export async function getTestCasesForSuite(suiteId: string): Promise<TestCase[]> {
  if (!isGpu1Backed()) return mock.getTestCasesForSuite(suiteId)
  return camelRows<TestCase>(await rest<RawRow[]>(`test_cases?select=*&suite_id=eq.${suiteId}&order=id`))
}

export async function getTestRunsForCopilot(copilotId: string): Promise<TestRun[]> {
  if (!isGpu1Backed()) return mock.getTestRunsForCopilot(copilotId)
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
  if (!isGpu1Backed()) return mock.getTestResultsForRun(runId)
  return camelRows<TestResult>(await rest<RawRow[]>(`test_results?select=*&run_id=eq.${runId}&order=id`))
}

export async function getRunsForCopilot(copilotId: string): Promise<AgentRun[]> {
  if (!isGpu1Backed()) return mock.getRunsForCopilot(copilotId)
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
  if (!isGpu1Backed()) return mock.getRun(id)
  const rows = await rest<RawRow[]>(`agent_runs?select=*,agent_run_steps(id)&id=eq.${id}`)
  if (!rows[0]) return undefined
  const { agent_run_steps, ...rest_ } = rows[0] as RawRow & { agent_run_steps: { id: string }[] }
  const run = camelRow<AgentRun>(rest_)
  run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
  return run
}

export async function getRecentRuns(limit = 30): Promise<AgentRun[]> {
  if (!isGpu1Backed()) {
    return [...mock.agentRuns].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)).slice(0, limit)
  }
  const rows = await rest<RawRow[]>(
    `agent_runs?select=*,agent_run_steps(id)&order=started_at.desc&limit=${limit}`
  )
  return rows.map((r) => {
    const { agent_run_steps, ...rest_ } = r as RawRow & { agent_run_steps: { id: string }[] }
    const run = camelRow<AgentRun>(rest_)
    run.stepIds = (agent_run_steps ?? []).map((s) => s.id)
    return run
  })
}

/** Traces d'un projet : les runs de SES copilotes (menu Traces par projet). */
export async function getRecentRunsForProject(projectId: string, limit = 30): Promise<AgentRun[]> {
  if (!isGpu1Backed()) {
    return [...mock.agentRuns]
      .filter((r) => r.projectId === projectId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1))
      .slice(0, limit)
  }
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
  if (!isGpu1Backed()) return mock.getStepsForRun(runId)
  return camelRows<AgentRunStep>(
    await rest<RawRow[]>(`agent_run_steps?select=*&run_id=eq.${runId}&order=index`)
  )
}

export async function getToolCallsForRun(runId: string): Promise<ToolCall[]> {
  if (!isGpu1Backed()) return mock.getToolCallsForRun(runId)
  return camelRows<ToolCall>(await rest<RawRow[]>(`tool_calls?select=*&run_id=eq.${runId}&order=id`))
}

export async function getBenchmarkSuitesForCopilot(copilotId: string): Promise<BenchmarkSuite[]> {
  if (!isGpu1Backed()) return mock.getBenchmarkSuitesForCopilot(copilotId)
  return camelRows<BenchmarkSuite>(
    await rest<RawRow[]>(`benchmark_suites?select=*&copilot_id=eq.${copilotId}&order=name`)
  )
}

export async function getBenchmarkRunsForSuite(suiteId: string): Promise<BenchmarkRun[]> {
  if (!isGpu1Backed()) return mock.getBenchmarkRunsForSuite(suiteId)
  return camelRows<BenchmarkRun>(
    await rest<RawRow[]>(`benchmark_runs?select=*&suite_id=eq.${suiteId}&order=started_at.desc`)
  )
}

export async function getBenchmarkResultForRun(runId: string): Promise<BenchmarkResult | undefined> {
  if (!isGpu1Backed()) return mock.getBenchmarkResultForRun(runId)
  return camelRows<BenchmarkResult>(await rest<RawRow[]>(`benchmark_results?select=*&run_id=eq.${runId}`))[0]
}

export async function getReplayComparisonsForCopilot(copilotId: string): Promise<ReplayComparison[]> {
  if (!isGpu1Backed()) return mock.getReplayComparisonsForCopilot(copilotId)
  return camelRows<ReplayComparison>(
    await rest<RawRow[]>(`replay_comparisons?select=*&copilot_id=eq.${copilotId}&order=created_at.desc`)
  )
}

export async function getShadowExperimentsForCopilot(copilotId: string): Promise<ShadowExperiment[]> {
  if (!isGpu1Backed()) return mock.getShadowExperimentsForCopilot(copilotId)
  return camelRows<ShadowExperiment>(
    await rest<RawRow[]>(`shadow_experiments?select=*&copilot_id=eq.${copilotId}&order=started_at.desc`)
  )
}

export async function getPromotionGateForCopilot(copilotId: string): Promise<PromotionGate | undefined> {
  if (!isGpu1Backed()) return mock.getPromotionGateForCopilot(copilotId)
  return camelRows<PromotionGate>(
    await rest<RawRow[]>(`promotion_gates?select=*&copilot_id=eq.${copilotId}&order=last_evaluated_at.desc&limit=1`)
  )[0]
}

export async function getRecentWarnings(limit = 6): Promise<RegistryWarning[]> {
  if (!isGpu1Backed()) return mock.getRecentWarnings(limit)
  return camelRows<RegistryWarning>(
    await rest<RawRow[]>(`registry_warnings?select=*&order=occurred_at.desc&limit=${limit}`)
  )
}

export async function getRegistryKpis(): Promise<ReturnType<typeof mock.getRegistryKpis>> {
  if (!isGpu1Backed()) return mock.getRegistryKpis()
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

// Labels statiques (pas de la data) — re-export pour import unique côté pages.
export { AGENT_RUNTIME_LABELS, MODEL_PROVIDER_LABELS } from './mock-data'
