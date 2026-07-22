#!/usr/bin/env node
/**
 * AIGENT-RESET-TRADEAGENT-022 — destructive reset of the agent perimeter.
 *
 * Deletes every copilot and everything hanging off it, so the platform can be
 * rebuilt from zero. This is a DESTRUCTIVE, product-level decision: run history,
 * costs, benchmarks and telemetry for agents are NOT preserved.
 *
 * ── What actually deletes what ────────────────────────────────────────────────
 * 15 tables carry `copilot_id … on delete cascade`, so deleting a `copilots`
 * row removes its versions, manifests, tools, runs, benchmark/test suites and
 * runs, proposals, sandbox reports and delivery events. `agent_run_steps` and
 * `tool_calls` cascade from `agent_runs`, so they go too — one level deeper.
 *
 * THREE columns reference a copilot WITHOUT a foreign key, so the database will
 * NOT clean them and they would silently become dangling ids:
 *   - mission_findings.copilot_id          (text, nullable)
 *   - mission_runs.orchestrator_copilot_id (text, nullable)
 *   - mission_runs.participant_copilot_ids (jsonb array)
 * These are nulled / emptied explicitly BEFORE the cascade, never left to luck.
 * `mission_runs` and `mission_findings` rows themselves are business data of a
 * project, not agent data, so the rows survive — only the agent pointers clear.
 *
 * ── What is NOT touched ──────────────────────────────────────────────────────
 * projects, project_builder_conversations / _messages, and every other business
 * table. This script only ever writes to the agent perimeter.
 *
 * Idempotent: a second `--apply` finds zero copilots, nothing to null, and exits
 * clean. Verification re-reads the database rather than trusting the writes.
 *
 * Usage:
 *   node --env-file=.env.local scripts/reset-agent-platform.mjs            # dry-run
 *   node --env-file=.env.local scripts/reset-agent-platform.mjs --apply    # write
 *
 * Secrets come from the environment and are never logged.
 */

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const apply = process.argv.includes('--apply')
const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }

async function req(method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      ...H,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Prefer: method === 'GET' ? 'count=exact' : 'return=representation',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    // Never echo the raw body: it can carry schema internals.
    throw new Error(`${method} ${path.split('?')[0]} -> ${res.status}`)
  }
  return res
}

async function count(table, filter = '') {
  const res = await req('GET', `${table}?select=id${filter ? '&' + filter : ''}`)
  return Number((res.headers.get('content-range') ?? '/0').split('/')[1])
}

/** Tables whose agent rows disappear via cascade, reported for evidence. */
const CASCADING = [
  'copilot_versions',
  'manifests',
  'tools',
  'agent_runs',
  'agent_run_steps',
  'tool_calls',
  'benchmark_suites',
  'benchmark_runs',
  'benchmark_results',
  'test_suites',
  'test_runs',
  'test_results',
  'test_cases',
  'improvement_proposals',
  'sandbox_reports',
  'agent_delivery_events',
  'promotion_gates',
  'shadow_experiments',
  'replay_comparisons',
  'registry_warnings',
  'project_agent_relations',
]

/** Business tables that must be observably untouched. */
const MUST_NOT_CHANGE = ['projects', 'project_builder_conversations', 'project_builder_messages', 'mission_runs']

console.log(`\nAIGENT-RESET-TRADEAGENT-022 — agent platform reset`)
console.log(`mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN'}\n`)

// ── 1. Volumes before ────────────────────────────────────────────────────────
const before = {}
for (const t of ['copilots', ...CASCADING, ...MUST_NOT_CHANGE, 'mission_findings']) {
  before[t] = await count(t)
}

const copilots = await (await req('GET', 'copilots?select=id,name,project_id,status&order=name')).json()

console.log('VOLUMES BEFORE')
console.log(`  copilots${''.padEnd(24)} ${before.copilots}`)
for (const t of CASCADING) console.log(`  ${t.padEnd(32)} ${before[t]}`)
console.log('  --- business, must not change ---')
for (const t of MUST_NOT_CHANGE) console.log(`  ${t.padEnd(32)} ${before[t]}`)
console.log(`  mission_findings${''.padEnd(16)} ${before.mission_findings}`)

// Dangling pointers that no FK will clean.
const findings = await (await req('GET', 'mission_findings?select=id,copilot_id')).json()
const findingsToNull = findings.filter((f) => f.copilot_id !== null)
const missionRuns = await (
  await req('GET', 'mission_runs?select=id,orchestrator_copilot_id,participant_copilot_ids')
).json()
const runsToClear = missionRuns.filter(
  (r) => r.orchestrator_copilot_id !== null || (r.participant_copilot_ids ?? []).length > 0
)

console.log('\nNON-FK POINTERS (no cascade — cleared explicitly)')
console.log(`  mission_findings.copilot_id to null      ${findingsToNull.length}`)
console.log(`  mission_runs agent pointers to clear     ${runsToClear.length}`)

console.log(`\nCOPILOTS TO DELETE (${copilots.length})`)
for (const c of copilots) {
  console.log(`  ${(c.project_id ?? 'NULL').padEnd(30)} ${(c.status ?? '').padEnd(9)} ${c.name}`)
}

if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to delete.')
  process.exit(0)
}

if (copilots.length === 0 && findingsToNull.length === 0 && runsToClear.length === 0) {
  console.log('\n✓ already reset — nothing to do (idempotent).')
  process.exit(0)
}

// ── 2. Clear non-FK pointers FIRST ───────────────────────────────────────────
// Order matters: do this before the cascade, so a failure here aborts while the
// copilots still exist and the state is still coherent.
if (findingsToNull.length > 0) {
  await req('PATCH', 'mission_findings?copilot_id=not.is.null', { copilot_id: null })
}
for (const r of runsToClear) {
  await req('PATCH', `mission_runs?id=eq.${encodeURIComponent(r.id)}`, {
    orchestrator_copilot_id: null,
    participant_copilot_ids: [],
  })
}
console.log('\n✓ non-FK agent pointers cleared')

// ── 3. Delete copilots — the cascade does the rest ───────────────────────────
if (copilots.length > 0) {
  await req('DELETE', 'copilots?id=not.is.null')
}
console.log('✓ copilots deleted (cascade applied)')

// ── 4. Verify by RE-READING, never by trusting the writes ────────────────────
const after = {}
for (const t of ['copilots', ...CASCADING, ...MUST_NOT_CHANGE, 'mission_findings']) {
  after[t] = await count(t)
}

console.log('\nVOLUMES AFTER')
console.log(`  copilots${''.padEnd(24)} ${after.copilots}`)
for (const t of CASCADING) console.log(`  ${t.padEnd(32)} ${after[t]}`)

const problems = []
if (after.copilots !== 0) problems.push(`copilots = ${after.copilots}, expected 0`)
for (const t of CASCADING) {
  if (after[t] !== 0) problems.push(`${t} = ${after[t]}, expected 0 (orphan rows)`)
}

// Business data must be observably intact — a reset that eats project data is a
// bug, not a reset.
console.log('\nBUSINESS DATA (must be unchanged)')
for (const t of MUST_NOT_CHANGE) {
  const ok = after[t] === before[t]
  console.log(`  ${t.padEnd(32)} ${before[t]} -> ${after[t]} ${ok ? '✓' : '✗'}`)
  if (!ok) problems.push(`${t} changed ${before[t]} -> ${after[t]} — business data touched`)
}
console.log(`  mission_findings${''.padEnd(16)} ${before.mission_findings} -> ${after.mission_findings} ${
  after.mission_findings === before.mission_findings ? '✓' : '✗'
}`)
if (after.mission_findings !== before.mission_findings) {
  problems.push('mission_findings rows were deleted — only the copilot_id should have been nulled')
}

// No dangling pointer may survive.
const findingsLeft = await count('mission_findings', 'copilot_id=not.is.null')
if (findingsLeft !== 0) problems.push(`mission_findings.copilot_id still set on ${findingsLeft} rows`)
const orchLeft = await count('mission_runs', 'orchestrator_copilot_id=not.is.null')
if (orchLeft !== 0) problems.push(`mission_runs.orchestrator_copilot_id still set on ${orchLeft} rows`)

if (problems.length > 0) {
  console.error('\n✗ RESET INCOMPLETE:')
  for (const p of problems) console.error(`    ${p}`)
  process.exit(1)
}

console.log('\n✓ reset complete — zero agents, zero runs, zero orphans, business data intact.')
