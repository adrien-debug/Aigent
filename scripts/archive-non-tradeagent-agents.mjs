#!/usr/bin/env node
/**
 * AIG-TRADEAGENT-ONLY-019 — archive the six `aig-trade-001` copilots that were
 * never attached to a project.
 *
 * Scope is deliberately narrow: Atlas, Vector, Sentinel, Pulse, Meridian and
 * Sage are the standalone trading roster. They carry `project_id IS NULL`, so
 * the run route already refuses them with a 409 ("no project assignment") —
 * archiving records the intent in the catalogue, it is not what blocks them.
 *
 * What this script does NOT do, on purpose:
 *  - it never deletes an `agent_runs` row, a tool call, a cost or a version.
 *    The 74 historical runs of these six stay readable exactly as they are.
 *  - it never rewrites `project_id` or `copilot_id`. An archived agent is not
 *    retro-attributed to TradeAgent.
 *  - it never touches a copilot belonging to another real project.
 *
 * Idempotent: selection is `status != archived` among a fixed id allowlist, so
 * a second run matches nothing and reports `0 changed`. Re-running can neither
 * duplicate a row nor resurrect one.
 *
 * Usage:
 *   node --env-file=.env.local scripts/archive-non-tradeagent-agents.mjs           # dry-run
 *   node --env-file=.env.local scripts/archive-non-tradeagent-agents.mjs --apply   # write
 *
 * Reads secrets from the environment only — never logs a key or a URL.
 */

/** The exact six. An allowlist, not a pattern: a name match must never decide a write. */
const ARCHIVE_IDS = [
  'copilot-atlas-market-structure-6836ef1e',
  'copilot-vector-quant-regime-75d7ad26',
  'copilot-sentinel-risk-manager-382793d6',
  'copilot-pulse-execution-scout-9cdc77e2',
  'copilot-meridian-macro-context-bb9435f5',
  'copilot-sage-trading-coach-8dea0500',
]

/** Value already allowed by the 0001 schema check — no new state invented. */
const ARCHIVED = 'archived'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const apply = process.argv.includes('--apply')
const headers = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }

async function rest(method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(method === 'PATCH' ? { Prefer: 'return=representation' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

const inList = `(${ARCHIVE_IDS.map((id) => `"${id}"`).join(',')})`

// 1) Read the current truth for the six ids.
const before = await rest('GET', `copilots?id=in.${inList}&select=id,name,status,project_id`)

const missing = ARCHIVE_IDS.filter((id) => !before.some((r) => r.id === id))
// A guard, not a formality: if an id vanished, stop rather than write a partial set.
if (missing.length > 0) {
  console.error('✗ these ids are absent from the database — refusing to continue:')
  for (const id of missing) console.error(`    ${id}`)
  process.exit(1)
}

// A project assignment would mean the agent is no longer the standalone roster
// this mission targets. Refuse rather than archive something that moved.
const attached = before.filter((r) => r.project_id !== null)
if (attached.length > 0) {
  console.error('✗ these ids now belong to a project — out of scope, refusing:')
  for (const r of attached) console.error(`    ${r.id} -> ${r.project_id}`)
  process.exit(1)
}

// 2) Historical runs must survive. Count them before and after as evidence.
const runsBefore = await countRuns()

async function countRuns() {
  const res = await fetch(`${base}/rest/v1/agent_runs?copilot_id=in.${inList}&select=id`, {
    headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
  })
  if (!res.ok) throw new Error(`count runs -> ${res.status}`)
  return Number((res.headers.get('content-range') ?? '/0').split('/')[1])
}

const todo = before.filter((r) => r.status !== ARCHIVED)

console.log(`\nAIG-TRADEAGENT-ONLY-019 — archive standalone aig-trade-001 roster`)
console.log(`mode              : ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log(`targeted          : ${ARCHIVE_IDS.length}`)
console.log(`already archived  : ${before.length - todo.length}`)
console.log(`to archive        : ${todo.length}`)
console.log(`historical runs   : ${runsBefore} (must be unchanged after)\n`)

for (const r of before) {
  const mark = r.status === ARCHIVED ? 'skip' : apply ? 'ARCHIVE' : 'would'
  console.log(`  ${mark.padEnd(8)} ${r.status.padEnd(8)} ${r.name}`)
}

if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to write.')
  process.exit(0)
}

if (todo.length === 0) {
  console.log('\n✓ nothing to do — already converged (idempotent).')
  process.exit(0)
}

// 3) Write. PostgREST has no multi-statement transaction here, so the update is
//    a single filtered PATCH: it either matches the set or it does not. The
//    filter repeats `status != archived` so a concurrent run cannot double-apply.
const todoList = `(${todo.map((r) => `"${r.id}"`).join(',')})`
const updated = await rest(
  'PATCH',
  `copilots?id=in.${todoList}&status=neq.${ARCHIVED}&select=id,name,status`,
  { status: ARCHIVED }
)

// 4) Prove it by reading back, and prove history survived.
const after = await rest('GET', `copilots?id=in.${inList}&select=id,name,status,project_id`)
const runsAfter = await countRuns()
const stillNotArchived = after.filter((r) => r.status !== ARCHIVED)

console.log(`\nupdated           : ${updated.length}`)
console.log(`archived now      : ${after.filter((r) => r.status === ARCHIVED).length}/${after.length}`)
console.log(`historical runs   : ${runsAfter} (was ${runsBefore})`)

if (stillNotArchived.length > 0) {
  console.error('\n✗ some rows did not converge:')
  for (const r of stillNotArchived) console.error(`    ${r.id} = ${r.status}`)
  process.exit(1)
}
if (runsAfter !== runsBefore) {
  console.error(`\n✗ run history changed (${runsBefore} -> ${runsAfter}) — investigate immediately`)
  process.exit(1)
}
// project_id must be untouched: archiving is not a re-attribution.
if (after.some((r) => r.project_id !== null)) {
  console.error('\n✗ a project_id was modified — this script must never do that')
  process.exit(1)
}

console.log('\n✓ archived, history intact, no re-attribution.')
