#!/usr/bin/env node
/**
 * DEV SEED — populate an EMPTY development perimeter so the agent screens render.
 *
 * ── Exact commands ───────────────────────────────────────────────────────────
 *   # 1. dry-run (DEFAULT — reads only, writes nothing, prints the plan)
 *   NODE_ENV=development node --env-file=.env.local scripts/dev-seed.mjs
 *
 *   # 2. actually write
 *   NODE_ENV=development node --env-file=.env.local scripts/dev-seed.mjs --write
 *
 *   # 3. remove everything this script created (dry-run without --write)
 *   NODE_ENV=development node --env-file=.env.local scripts/dev-seed.mjs --clean --write
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * The data layer is LIVE-ONLY (src/lib/agent-mission-control/data.ts): no mock,
 * no fixture fallback. On a fresh dev perimeter `/admin/agents` renders "No
 * agents yet" and `/admin/agents/<id>/*` returns 404, so nine screens of the
 * agent domain cannot be looked at — every UI fix on them has to be argued from
 * the source instead of from a rendered pixel. This script writes the minimum
 * persisted truth those screens read.
 *
 * ── What is written, and why each table ──────────────────────────────────────
 *   projects                  a copilot with no existing project reads as
 *                             `unavailable` (available-agents.ts checks the row)
 *   copilots                  the five lifecycle statuses, one agent each
 *   copilot_versions          `version` is a hard requirement of the runtime
 *                             availability contract; without it → unavailable
 *   manifests                 no manifest ⇒ no tools, no capabilities, and
 *                             `requiresHumanApproval` fails closed to true
 *   tools                     a manifest tool id with no `tools` row is exactly
 *                             what makes an agent `degraded` — one agent below
 *                             declares one on purpose so that state is visible
 *   agent_runs                completed AND failed, with latency + cost, spread
 *   + steps + tool_calls      over the last 24h so the dashboard/performance
 *                             charts and the run history have something to draw
 *   test_* / benchmark_*      the health resolver derives testPassRate,
 *                             avgLatencyMs and benchmarkScore from these; with
 *                             none, every KPI legitimately renders a dash
 *   project_agent_relations   the team canvas draws edges from rows only
 *   runtime_telemetry_events  /admin/telemetry reads this table and nothing else
 *
 * ── SEEDED DATA IS FAKE AND SAYS SO ──────────────────────────────────────────
 * Every id, slug and human label starts with `seed-` / `seed · `. Nothing here
 * is a measurement: the runs never executed, the scores were typed by hand. The
 * repo forbids presenting simulated data as real (CLAUDE.md §3), so the naming
 * is the disclosure, and it is also the blast radius: every write and every
 * delete this script performs is filtered on that prefix, so it can neither
 * touch nor remove a row it did not create.
 *
 * ── Fail-closed dev guard (see assertDevEnvironment) ─────────────────────────
 * Refuses unless the environment PROVES it is dev. Absence of proof is a
 * refusal, not a default-allow: an unset NODE_ENV stops the script.
 *
 * ── Idempotent ───────────────────────────────────────────────────────────────
 * Every row has a deterministic id. Each table is read first (`id=in.(...)`) and
 * only the missing ids are inserted — an existing row is never updated, never
 * duplicated. A second `--write` inserts 0 rows.
 *
 * Secrets come from the environment and are never printed.
 */

// ---------------------------------------------------------------------------
// Fail-closed dev guard — FIRST, before anything reads or writes
// ---------------------------------------------------------------------------

/** Values that mark a production environment in any of the vars we consult. */
const PRODUCTION_VALUES = new Set(['production', 'prod'])
/** Values that PROVE a development environment. Anything else proves nothing. */
const DEVELOPMENT_VALUES = new Set(['development', 'dev', 'test'])

/** Env vars that carry an environment name in this repo and its hosts. */
const ENV_VARS = ['NODE_ENV', 'AMC_ENV', 'APP_ENV', 'NEXT_PUBLIC_APP_ENV', 'VERCEL_ENV']

/**
 * Refuse to run anywhere that is not provably development.
 *
 * Two independent conditions, both required:
 *   1. NO production marker in any environment variable we know about. One is
 *      enough to stop: a machine that calls itself production is production.
 *   2. AT LEAST ONE positive development marker. This is the fail-closed half —
 *      a bare `node scripts/dev-seed.mjs` with an unset NODE_ENV cannot prove
 *      anything, so it is refused rather than assumed safe. That is why the
 *      documented command sets NODE_ENV=development explicitly.
 *
 * What this guard does NOT do, stated plainly so nobody trusts it further than
 * it goes: it cannot tell one PostgREST host from another. It reads the
 * environment, not the database. Pointing AMC_SUPABASE_URL at a production base
 * while claiming NODE_ENV=development would still write there — bounded to the
 * `seed-` namespace, but written. The operator owns that choice; the guard only
 * makes the accidental version impossible.
 */
function assertDevEnvironment() {
  const named = ENV_VARS.map((name) => [name, (process.env[name] ?? '').trim().toLowerCase()])

  const production = named.filter(([, value]) => PRODUCTION_VALUES.has(value))
  if (production.length > 0) {
    const shown = production.map(([name, value]) => `${name}=${value}`).join(', ')
    fail(`refused: production environment detected (${shown}). This script is DEV ONLY.`)
  }

  // Continuous integration is not a dev workstation: a CI job that seeded a
  // shared perimeter would poison every other job reading it.
  const ci = (process.env.CI ?? '').trim().toLowerCase()
  if (ci !== '' && ci !== '0' && ci !== 'false') {
    fail('refused: CI detected (CI is set). This script is for a developer machine only.')
  }

  const dev = named.filter(([, value]) => DEVELOPMENT_VALUES.has(value))
  if (dev.length === 0) {
    fail(
      'refused: no environment variable proves this is development.\n' +
        `  Set one of ${ENV_VARS.join(' / ')} to development|dev|test.\n` +
        '  Documented command: NODE_ENV=development node --env-file=.env.local scripts/dev-seed.mjs'
    )
  }

  return dev.map(([name, value]) => `${name}=${value}`).join(', ')
}

function fail(message) {
  console.error(`✗ ${message}`)
  process.exit(2)
}

const devProof = assertDevEnvironment()

// ---------------------------------------------------------------------------
// Backend — the same live PostgREST perimeter the app reads (postgrest.ts)
// ---------------------------------------------------------------------------

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
  fail('backend not configured (AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
}

const argv = process.argv.slice(2)
const write = argv.includes('--write')
const clean = argv.includes('--clean')

const HEADERS = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
/** Same hard cap as the app's PostgREST client — a hung backend must not hang the seed. */
const TIMEOUT_MS = 30_000

/**
 * One PostgREST round trip. The raw response body is never echoed: it can carry
 * schema internals, and on this path it could carry row values too.
 */
async function req(method, pathAndQuery, body, prefer) {
  const res = await fetch(`${base}/rest/v1/${pathAndQuery}`, {
    method,
    headers: {
      ...HEADERS,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new Error(`${method} ${pathAndQuery.split('?')[0]} -> ${res.status} ${detail}`)
  }
  if (res.status === 204) return []
  const text = await res.text()
  return text ? JSON.parse(text) : []
}

// ---------------------------------------------------------------------------
// The dataset — deterministic ids, visibly fake labels
// ---------------------------------------------------------------------------

/**
 * The one prefix that defines this script's blast radius. Reads, inserts and
 * deletes are all keyed on it; a row without it is invisible to this script.
 */
const PREFIX = 'seed-'

const PROJECT_ID = 'seed-project-lab'
const MODEL = 'gpt-5.4'
const PROVIDER = 'openai'
/** LangGraph is mandatory for every agent on this platform (AGENTS.md). */
const RUNTIME = 'langgraph'
/**
 * A run label that is NOT in EVALUATION_RUN_LABELS (types.ts): the health
 * resolvers and every "recent runs" read exclude `test-case` / `benchmark-task`
 * rows, so a seed run wearing one of those labels would be filtered out of the
 * very screens this seed exists to fill.
 */
const RUN_LABEL = 'seed-operator-check'

const NOW = Date.now()
const iso = (msAgo) => new Date(NOW - msAgo).toISOString()
const HOUR = 60 * 60 * 1000

/**
 * Tool names the runner can actually execute (the native read handlers of
 * tool-handlers.ts). A manifest that declares a tool whose row name is NOT in
 * that set resolves to nothing and the agent reads `degraded` — see
 * available-agents.ts `isResolved`. So the seeded rows use real names, and the
 * ONE degraded agent below gets its degradation from a missing row instead of a
 * bogus name, which is the failure mode operators actually hit.
 *
 * Values (mutates/risk/confirmation) mirror registry/tools.ts exactly, because
 * `npm run check:tool-rows` compares live rows to that registry and fails on any
 * drift. A seed that drifted would turn a green gate red for everyone.
 */
const READ_TOOLS = [
  { name: 'read_project_summary', label: 'Read project summary' },
  { name: 'read_copilot_summary', label: 'Read copilot summary' },
  { name: 'read_recent_runs', label: 'Read recent runs' },
  { name: 'read_tool_permissions', label: 'Read tool permissions' },
]

const toolId = (agentKey, name) => `${PREFIX}tool-${agentKey}-${name.replace(/_/g, '-')}`

/**
 * The five lifecycle statuses `copilots.status` allows, one agent each, so every
 * badge/branch of the agent list has a live example to render.
 *
 * `runtimeNote` records what the RUNTIME status will derive to (available-agents.ts),
 * which is a different axis from the lifecycle status stored here — the repo
 * insists those two vocabularies stay distinguishable (labels.ts).
 */
const AGENTS = [
  {
    key: 'alpha',
    status: 'active',
    stage: 'production',
    name: 'seed · Alpha Reader (active)',
    description: 'Seeded agent — fully wired: project, version, manifest and four resolvable read tools.',
    toolNames: READ_TOOLS.map((t) => t.name),
    extraToolIds: [],
    runtimeNote: 'active',
  },
  {
    key: 'bravo',
    status: 'draft',
    stage: 'draft',
    name: 'seed · Bravo Draft (draft)',
    description: 'Seeded agent — authored but never promoted; runtime reads it as inactive, not broken.',
    toolNames: ['read_project_summary'],
    extraToolIds: [],
    runtimeNote: 'inactive',
  },
  {
    key: 'charlie',
    status: 'degraded',
    stage: 'beta',
    name: 'seed · Charlie Unresolved (degraded)',
    description: 'Seeded agent — declares a tool id that has no tools row, the concrete cause of degradation.',
    toolNames: ['read_project_summary'],
    // Declared in the manifest, deliberately never inserted into `tools`.
    extraToolIds: [`${PREFIX}tool-charlie-never-registered`],
    runtimeNote: 'degraded',
  },
  {
    key: 'delta',
    status: 'paused',
    stage: 'beta',
    name: 'seed · Delta Paused (paused)',
    description: 'Seeded agent — deliberately not serving; executable path intact.',
    toolNames: ['read_recent_runs'],
    extraToolIds: [],
    runtimeNote: 'inactive',
  },
  {
    key: 'echo',
    status: 'archived',
    stage: 'archived',
    name: 'seed · Echo Retired (archived)',
    description: 'Seeded agent — retired. Archival outranks every other check and reads as unavailable.',
    toolNames: ['read_copilot_summary'],
    extraToolIds: [],
    runtimeNote: 'unavailable',
  },
]

const agentId = (key) => `${PREFIX}agent-${key}`
const versionId = (key) => `${PREFIX}version-${key}-1`
const manifestId = (key) => `${PREFIX}manifest-${key}`

const projects = [
  {
    id: PROJECT_ID,
    name: 'seed · Dev Lab',
    slug: 'seed-dev-lab',
    description: 'Seeded development project. Not a real product — created by scripts/dev-seed.mjs.',
    platform: 'web',
    created_at: iso(30 * 24 * HOUR),
  },
]

const copilots = AGENTS.map((a) => ({
  id: agentId(a.key),
  project_id: PROJECT_ID,
  name: a.name,
  slug: `${PREFIX}agent-${a.key}`,
  description: a.description,
  runtime: RUNTIME,
  status: a.status,
  // The production pointer only exists for the agent whose version is served.
  // Set at INSERT: the promotion guard trigger (migration 0032) only refuses
  // UPDATEs into the live state, and this seed never updates a copilot.
  production_version_id: a.stage === 'production' ? versionId(a.key) : null,
  latest_version_id: versionId(a.key),
  model: MODEL,
  model_provider: PROVIDER,
  owner: 'seed-dev-seed',
  tags: ['seed', 'dev-only'],
  created_at: iso(20 * 24 * HOUR),
  updated_at: iso(2 * HOUR),
  // Left empty on purpose: the read layer overwrites stored health with
  // run-backed truth and marks anything it cannot prove as unavailable. Writing
  // numbers here would fabricate measurements the runs do not support.
  health: {},
  created_via: 'dev-seed',
}))

const copilotVersions = AGENTS.map((a) => ({
  id: versionId(a.key),
  copilot_id: agentId(a.key),
  label: 'v1.0.0-seed',
  stage: a.stage,
  manifest_id: manifestId(a.key),
  model: MODEL,
  model_provider: PROVIDER,
  changelog: 'Seeded version — created by scripts/dev-seed.mjs, never built from a real change.',
  created_at: iso(10 * 24 * HOUR),
  created_by: 'seed-dev-seed',
  // Zero-init baseline, exactly like the authoring path writes it. The read
  // layer treats these as placeholders, not measurements, and prefers run
  // evidence when it exists.
  scores: { testPassRate: 0, benchmarkScore: 0, unsafeActionCount: 0 },
}))

const manifests = AGENTS.map((a) => ({
  id: manifestId(a.key),
  copilot_id: agentId(a.key),
  version: 'v1.0.0-seed',
  system_prompt_summary: 'Seeded manifest. Read-only assistant used to make the dev dashboard renderable.',
  allowed_routes: ['/admin', '/admin/agents'],
  forbidden_actions: ['write to any production system', 'move funds', 'delete data'],
  // 'never' + read-only tools is what lets the catalogue derive readOnly=true and
  // requiresHumanApproval=false, so both sides of those UI branches get a case.
  confirmation_policy: a.key === 'alpha' ? 'never' : 'risky-only',
  always_confirm_actions: [],
  memory_sources: [],
  output_contract: { kind: 'text' },
  tool_ids: [...a.toolNames.map((n) => toolId(a.key, n)), ...a.extraToolIds],
  max_steps_per_run: 12,
  max_cost_per_run_usd: 0.5,
  updated_at: iso(3 * HOUR),
  skills: a.toolNames.map((n) => ({ label: `seed · ${n}` })),
}))

const tools = AGENTS.flatMap((a) =>
  a.toolNames.map((name) => {
    const spec = READ_TOOLS.find((t) => t.name === name)
    return {
      id: toolId(a.key, name),
      copilot_id: agentId(a.key),
      name,
      description: `${spec.label} — seeded row, mirrors registry/tools.ts.`,
      provider: 'internal',
      // Registry values, verbatim: db-read ⇒ low risk, no confirmation, no write.
      risk_level: 'low',
      enabled: true,
      requires_confirmation: false,
      mutates: false,
      scoped_routes: [],
      calls_last_7d: 0,
      error_rate_last_7d: 0,
    }
  })
)

/**
 * Runs — the only rows that make the 24h charts, the cost/latency KPIs and the
 * run history non-empty. Deliberately mixed: 8 completed and 3 failed, spread
 * across the window at ~2h intervals so hourly bucketing shows a shape rather
 * than one spike.
 *
 * `model_unverified` is false ONLY on completed runs: the catalogue reads that
 * flag to decide whether it may show an EXECUTED model, and a failed run proves
 * nothing about which model answered.
 */
const RUN_PLAN = [
  { key: 'alpha', status: 'completed', hoursAgo: 1, latency: 2140, cost: 0.0182, tools: 3 },
  { key: 'alpha', status: 'completed', hoursAgo: 3, latency: 1780, cost: 0.0149, tools: 2 },
  { key: 'alpha', status: 'failed', hoursAgo: 5, latency: 9310, cost: 0.0071, tools: 1 },
  { key: 'alpha', status: 'completed', hoursAgo: 7, latency: 2960, cost: 0.0231, tools: 4 },
  { key: 'alpha', status: 'completed', hoursAgo: 9, latency: 1520, cost: 0.0118, tools: 2 },
  { key: 'charlie', status: 'failed', hoursAgo: 11, latency: 6440, cost: 0.0044, tools: 0 },
  { key: 'charlie', status: 'completed', hoursAgo: 13, latency: 3310, cost: 0.0207, tools: 2 },
  { key: 'delta', status: 'completed', hoursAgo: 15, latency: 2480, cost: 0.0163, tools: 2 },
  { key: 'delta', status: 'failed', hoursAgo: 17, latency: 11_020, cost: 0.0038, tools: 1 },
  { key: 'alpha', status: 'completed', hoursAgo: 19, latency: 2010, cost: 0.0175, tools: 3 },
  { key: 'alpha', status: 'completed', hoursAgo: 22, latency: 2650, cost: 0.0194, tools: 3 },
]

const runs = RUN_PLAN.map((r, i) => {
  const n = String(i + 1).padStart(2, '0')
  const startedMsAgo = r.hoursAgo * HOUR
  return {
    id: `${PREFIX}run-${n}`,
    copilot_id: agentId(r.key),
    version_id: versionId(r.key),
    project_id: PROJECT_ID,
    user_label: RUN_LABEL,
    started_at: iso(startedMsAgo),
    finished_at: iso(startedMsAgo - r.latency),
    status: r.status,
    input_summary: `seed · operator prompt #${n}`,
    output_summary:
      r.status === 'completed'
        ? `seed · answered from ${r.tools} read tool call(s)`
        : 'seed · run failed before producing an answer',
    tool_call_count: r.tools,
    unsafe_attempt_count: 0,
    latency_ms: r.latency,
    cost_usd: r.cost,
    resolved_model: r.status === 'completed' ? MODEL : null,
    resolved_provider: r.status === 'completed' ? PROVIDER : null,
    model_unverified: r.status !== 'completed',
    created_via: 'dev-seed',
  }
})

/**
 * Steps + tool calls for the four most recent runs only. The run timeline needs
 * a populated case to be looked at; every run carrying a full trace would just
 * be more rows to delete later.
 */
const TRACED_RUNS = runs.slice(0, 4)

const runSteps = TRACED_RUNS.flatMap((run, ri) => {
  const failed = run.status === 'failed'
  return [
    {
      id: `${PREFIX}step-${ri + 1}-1`,
      run_id: run.id,
      index: 0,
      kind: 'llm-call',
      title: 'seed · plan the answer',
      detail: 'Seeded step — no model was called.',
      status: 'ok',
      started_at: run.started_at,
      duration_ms: 620,
      tool_call_id: null,
    },
    {
      id: `${PREFIX}step-${ri + 1}-2`,
      run_id: run.id,
      index: 1,
      kind: 'tool-call',
      title: 'seed · read_project_summary',
      detail: failed ? 'Seeded step — upstream read refused.' : 'Seeded step — read returned a summary.',
      status: failed ? 'error' : 'ok',
      started_at: run.started_at,
      duration_ms: 880,
      tool_call_id: `${PREFIX}call-${ri + 1}-1`,
    },
    {
      id: `${PREFIX}step-${ri + 1}-3`,
      run_id: run.id,
      index: 2,
      kind: 'output',
      title: 'seed · emit answer',
      detail: failed ? 'Seeded step — never reached.' : 'Seeded step — answer emitted.',
      status: failed ? 'blocked' : 'ok',
      started_at: run.started_at,
      duration_ms: 210,
      tool_call_id: null,
    },
  ]
})

const toolCalls = TRACED_RUNS.map((run, ri) => ({
  id: `${PREFIX}call-${ri + 1}-1`,
  run_id: run.id,
  tool_id: toolId('alpha', 'read_project_summary'),
  tool_name: 'read_project_summary',
  arguments_summary: '{ projectId: "seed-project-lab" }',
  result_summary: run.status === 'failed' ? 'seed · error' : 'seed · 1 project summary',
  status: run.status === 'failed' ? 'error' : 'ok',
  risk_level: 'low',
  required_confirmation: false,
  latency_ms: 880,
}))

/**
 * Test + benchmark evidence for the active agent only. The health resolver
 * derives testPassRate / avgLatencyMs from the latest COMPLETED test_run and
 * benchmarkScore from the latest COMPLETED benchmark_run; with none of these,
 * those KPIs correctly render "not measured" everywhere, which hides the whole
 * populated state of those tiles.
 */
const TEST_SUITE_ID = `${PREFIX}suite-alpha-behavior`
const TEST_RUN_ID = `${PREFIX}testrun-alpha-1`
const BENCH_SUITE_ID = `${PREFIX}bench-alpha`
const BENCH_RUN_ID = `${PREFIX}benchrun-alpha-1`
const BENCH_RESULT_ID = `${PREFIX}benchresult-alpha-1`

const testSuites = [
  {
    id: TEST_SUITE_ID,
    copilot_id: agentId('alpha'),
    name: 'seed · behaviour suite',
    description: 'Seeded suite — the cases below were never executed.',
    kind: 'behavior',
    last_run_id: TEST_RUN_ID,
  },
]

const TEST_CASES = [
  { n: 1, name: 'seed · answers from the project summary', outcome: 'pass', latency: 1840 },
  { n: 2, name: 'seed · refuses an out-of-scope route', outcome: 'pass', latency: 1610 },
  { n: 3, name: 'seed · reports an unavailable metric as unavailable', outcome: 'fail', latency: 2270 },
]

const testCases = TEST_CASES.map((c) => ({
  id: `${PREFIX}case-alpha-${c.n}`,
  suite_id: TEST_SUITE_ID,
  name: c.name,
  input: `seed · input #${c.n}`,
  expected_behavior: 'seed · expected behaviour text',
  expected_tool_calls: ['read_project_summary'],
  tags: ['seed'],
}))

const testRuns = [
  {
    id: TEST_RUN_ID,
    suite_id: TEST_SUITE_ID,
    copilot_id: agentId('alpha'),
    version_id: versionId('alpha'),
    triggered_by: 'seed-dev-seed',
    started_at: iso(4 * HOUR),
    finished_at: iso(4 * HOUR - 90_000),
    status: 'completed',
    // Rate is a 0..1 fraction here (same scale as the stored health blob).
    pass_rate: 2 / 3,
    total_cost_usd: 0.0121,
  },
]

const testResults = TEST_CASES.map((c) => ({
  id: `${PREFIX}result-alpha-${c.n}`,
  run_id: TEST_RUN_ID,
  case_id: `${PREFIX}case-alpha-${c.n}`,
  status: c.outcome,
  actual_behavior: `seed · actual behaviour #${c.n}`,
  actual_tool_calls: ['read_project_summary'],
  failure_reason: c.outcome === 'fail' ? 'seed · returned a 0 instead of "unavailable"' : null,
  latency_ms: c.latency,
  cost_usd: 0.004,
}))

const benchmarkSuites = [
  {
    id: BENCH_SUITE_ID,
    copilot_id: agentId('alpha'),
    name: 'seed · read-path benchmark',
    description: 'Seeded benchmark suite — never executed.',
    task_count: 12,
    dimensions: ['accuracy', 'latency'],
  },
]

const benchmarkRuns = [
  {
    id: BENCH_RUN_ID,
    suite_id: BENCH_SUITE_ID,
    copilot_id: agentId('alpha'),
    version_id: versionId('alpha'),
    model: MODEL,
    model_provider: PROVIDER,
    runtime: RUNTIME,
    started_at: iso(6 * HOUR),
    finished_at: iso(6 * HOUR - 240_000),
    status: 'completed',
    result_id: BENCH_RESULT_ID,
  },
]

const benchmarkResults = [
  {
    id: BENCH_RESULT_ID,
    run_id: BENCH_RUN_ID,
    accuracy: 0.83,
    task_success_rate: 0.75,
    avg_latency_ms: 2280,
    p95_latency_ms: 5120,
    avg_cost_per_task_usd: 0.0161,
    total_cost_usd: 0.1932,
    unsafe_action_count: 0,
    unauthorized_route_count: 0,
    confirmation_mistake_count: 0,
    score: 0.79,
  },
]

/**
 * Team edges. `buildTeamEdges` drops any row whose endpoints are not both
 * members of the requested project, so both ends stay inside PROJECT_ID.
 */
const relations = [
  {
    id: `${PREFIX}relation-alpha-bravo`,
    project_id: PROJECT_ID,
    source_copilot_id: agentId('alpha'),
    target_copilot_id: agentId('bravo'),
    relation_type: 'orchestrates',
    label: 'seed · hands the draft over',
    is_active: true,
  },
  {
    id: `${PREFIX}relation-alpha-charlie`,
    project_id: PROJECT_ID,
    source_copilot_id: agentId('alpha'),
    target_copilot_id: agentId('charlie'),
    relation_type: 'sends-output-to',
    label: 'seed · forwards the summary',
    is_active: true,
  },
]

/**
 * Runtime telemetry — the opt-in lifecycle pings a DEPLOYED agent posts back.
 * `/admin/telemetry` reads this table and nothing else, so without rows it can
 * only show its own empty state.
 */
const TELEMETRY_PLAN = [
  { key: 'alpha', status: 'completed', hoursAgo: 1, latency: 1980 },
  { key: 'alpha', status: 'completed', hoursAgo: 4, latency: 2240 },
  { key: 'alpha', status: 'failed', hoursAgo: 6, latency: 8760 },
  { key: 'charlie', status: 'started', hoursAgo: 8, latency: null },
  { key: 'charlie', status: 'completed', hoursAgo: 10, latency: 3120 },
  { key: 'delta', status: 'failed', hoursAgo: 14, latency: 7410 },
]

const telemetryEvents = TELEMETRY_PLAN.map((t, i) => ({
  id: `${PREFIX}telemetry-${String(i + 1).padStart(2, '0')}`,
  project_id: PROJECT_ID,
  agent_id: agentId(t.key),
  agent_version: 'v1.0.0-seed',
  target_repo: 'seed-org/seed-target-repo',
  run_id: `${PREFIX}remote-run-${String(i + 1).padStart(2, '0')}`,
  provider: PROVIDER,
  model: MODEL,
  status: t.status,
  latency_ms: t.latency,
  input_shape: { kind: 'seed', fields: 2 },
  output_shape: { kind: 'seed', fields: 3 },
  // Redacted shapes only — same contract as POST /api/runtime-telemetry.
  error: t.status === 'failed' ? { code: 'seed_upstream_refused' } : {},
  usage: t.status === 'started' ? {} : { inputTokens: 820, outputTokens: 240 },
  environment: { runtime: 'node', seeded: true },
  received_at: iso(t.hoursAgo * HOUR),
}))

/**
 * Insert order = foreign-key order. `--clean` walks it backwards.
 *
 * `copilots.latest_version_id` and `copilot_versions.manifest_id` are plain text
 * columns with no FK, so pointing them at rows inserted later is legal; every
 * real FK (project → copilot → version/manifest/tool/run → step/call) is
 * respected by this order.
 */
const PLAN = [
  ['projects', projects],
  ['copilots', copilots],
  ['copilot_versions', copilotVersions],
  ['manifests', manifests],
  ['tools', tools],
  ['test_suites', testSuites],
  ['test_cases', testCases],
  ['test_runs', testRuns],
  ['test_results', testResults],
  ['benchmark_suites', benchmarkSuites],
  ['benchmark_runs', benchmarkRuns],
  ['benchmark_results', benchmarkResults],
  ['agent_runs', runs],
  ['agent_run_steps', runSteps],
  ['tool_calls', toolCalls],
  ['project_agent_relations', relations],
  ['runtime_telemetry_events', telemetryEvents],
]

// ---------------------------------------------------------------------------
// Idempotent apply
// ---------------------------------------------------------------------------

const quoted = (ids) => ids.map((id) => `"${id}"`).join(',')

/** Ids of `rows` that already exist in `table` — one round trip per table. */
async function existingIds(table, rows) {
  if (rows.length === 0) return new Set()
  const found = await req('GET', `${table}?select=id&id=in.(${quoted(rows.map((r) => r.id))})`)
  return new Set(found.map((r) => r.id))
}

async function seed() {
  let created = 0
  let skipped = 0
  for (const [table, rows] of PLAN) {
    const present = await existingIds(table, rows)
    const missing = rows.filter((r) => !present.has(r.id))
    skipped += rows.length - missing.length
    if (missing.length === 0) {
      console.log(`  = ${table.padEnd(24)} ${rows.length} row(s) already present`)
      continue
    }
    if (write) {
      // return=minimal: the inserted rows are already known locally, and not
      // reading them back keeps row values out of this process's memory/logs.
      await req('POST', table, missing, 'return=minimal')
    }
    created += missing.length
    console.log(`  ${write ? '+' : '·'} ${table.padEnd(24)} ${missing.length} row(s) ${write ? 'inserted' : 'would be inserted'}`)
  }
  return { created, skipped }
}

/**
 * Delete everything this script created — and only that. Every DELETE is
 * filtered on `id=like.seed-*`, so a row that does not carry the namespace is
 * unreachable from here even if it sits in the same table.
 */
async function cleanup() {
  let removed = 0
  for (const [table] of [...PLAN].reverse()) {
    const found = await req('GET', `${table}?select=id&id=like.${PREFIX}*`)
    if (found.length === 0) {
      console.log(`  = ${table.padEnd(24)} nothing seeded`)
      continue
    }
    if (write) await req('DELETE', `${table}?id=like.${PREFIX}*`, undefined, 'return=minimal')
    removed += found.length
    console.log(`  ${write ? '-' : '·'} ${table.padEnd(24)} ${found.length} row(s) ${write ? 'deleted' : 'would be deleted'}`)
  }
  return removed
}

const mode = clean ? 'CLEAN' : 'SEED'
console.log(`dev-seed — ${mode} · ${write ? 'WRITE' : 'DRY-RUN (default; pass --write to apply)'}`)
console.log(`dev proof: ${devProof} · namespace: ${PREFIX}*`)

try {
  if (clean) {
    const removed = await cleanup()
    console.log(`\n${write ? '✓' : '◦'} ${removed} seeded row(s) ${write ? 'deleted' : 'would be deleted'}.`)
  } else {
    const { created, skipped } = await seed()
    console.log(`\n${write ? '✓' : '◦'} ${created} row(s) ${write ? 'inserted' : 'would be inserted'}, ${skipped} already present.`)
    if (!write) console.log('  Nothing was written. Re-run with --write to apply.')
  }
} catch (err) {
  fail(err instanceof Error ? err.message : String(err))
}
