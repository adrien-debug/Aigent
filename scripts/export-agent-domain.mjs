#!/usr/bin/env node
/**
 * AIGENT-CORE-FACTORY-035 — restorable export of the agent domain.
 *
 * Dumps every agent-domain table to a single deterministic JSON file so the
 * current copilots (and everything hanging off them) can be RESTORED after the
 * new core is proven and the legacy purge runs. This is the safety net that
 * makes the purge reversible — the mission forbids deleting anything before the
 * replacement is proven, and this export is what "reversible" means in practice.
 *
 * ── What it exports ──────────────────────────────────────────────────────────
 * The agent perimeter, top-down: copilots, copilot_versions, manifests, tools,
 * agent_runs, agent_run_steps, tool_calls, test_suites/_cases/_runs/_results,
 * benchmark_suites/_runs/_results, improvement_proposals, agent_delivery_events,
 * sandbox_reports, runtime_telemetry_events, project_agent_relations, and the
 * agent POINTERS on mission_runs / mission_findings (so a restore can re-link
 * them). Projects and project_builder_* are BUSINESS data, not agent data —
 * exported read-only for context under `_context`, never targeted by the purge.
 *
 * ── Secrets ──────────────────────────────────────────────────────────────────
 * No env var, no key, no token is ever written. Every row is copied verbatim
 * from PostgREST; if a business row ever held a secret it would already be a
 * bug upstream — this script does not add one. Column values are data, not
 * credentials (the perimeter stores references by name, per doctrine §2/§7).
 *
 * ── Determinism ──────────────────────────────────────────────────────────────
 * Rows are sorted by id; JSON keys are sorted; two exports of an unchanged DB
 * are byte-identical (no runtime timestamp inside the payload — the wall-clock
 * is passed in via --stamp so the file itself stays reproducible in CI).
 *
 * Usage:
 *   node --env-file=.env.local scripts/export-agent-domain.mjs
 *   node --env-file=.env.local scripts/export-agent-domain.mjs --out delivery/agent-domain/export.json
 *
 * Restore: see scripts/restore-agent-domain.mjs (companion, --apply gated).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const argv = process.argv.slice(2)
const outArg = argv.indexOf('--out')
const OUT = outArg >= 0 ? argv[outArg + 1] : 'delivery/agent-domain/export.json'
const stampArg = argv.indexOf('--stamp')
const STAMP = stampArg >= 0 ? argv[stampArg + 1] : null // caller passes an ISO date; omitted → null (reproducible)

const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }

async function getAll(table, select = '*') {
  const rows = []
  const pageSize = 1000
  for (let from = 0; ; from += pageSize) {
    const res = await fetch(`${base}/rest/v1/${table}?select=${select}&order=id.asc`, {
      headers: { ...H, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' },
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`GET ${table} -> ${res.status}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < pageSize) break
  }
  return rows
}

/** Recursively sort object keys so the serialized output is canonical. */
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    const out = {}
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k])
    return out
  }
  return value
}

// Agent-domain tables the restore re-creates, in dependency order (parents first).
const AGENT_TABLES = [
  'copilots',
  'copilot_versions',
  'manifests',
  'tools',
  'agent_runs',
  'agent_run_steps',
  'tool_calls',
  'test_suites',
  'test_cases',
  'test_runs',
  'test_results',
  'benchmark_suites',
  'benchmark_runs',
  'benchmark_results',
  'improvement_proposals',
  'agent_delivery_events',
  'sandbox_reports',
  'runtime_telemetry_events',
  'project_agent_relations',
]

// Business tables exported read-only for context (never purged, never restored by us).
const CONTEXT_TABLES = ['projects', 'mission_runs', 'mission_findings']

async function main() {
  const data = {}
  const counts = {}
  for (const t of AGENT_TABLES) {
    const rows = await getAll(t)
    data[t] = rows
    counts[t] = rows.length
  }
  const context = {}
  for (const t of CONTEXT_TABLES) {
    const rows = await getAll(t)
    context[t] = rows
    counts[t] = rows.length
  }

  const payload = canonical({
    _meta: {
      mission: 'AIGENT-CORE-FACTORY-035',
      kind: 'agent-domain-export',
      exportedAt: STAMP, // null unless caller stamps → file stays reproducible
      source: 'gpu1 PostgREST perimeter (aigent)',
      agentTables: AGENT_TABLES,
      contextTables: CONTEXT_TABLES,
      counts,
      note:
        'Restore with scripts/restore-agent-domain.mjs --apply. Context tables are read-only ' +
        'business data (never purged, never restored by the companion script).',
    },
    agent: data,
    _context: context,
  })

  mkdirSync(dirname(OUT), { recursive: true })
  // Trailing newline; 2-space indent; canonical key order → reproducible bytes.
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n')

  const total = Object.entries(counts)
    .map(([t, n]) => `${t}=${n}`)
    .join(' ')
  console.log(`✓ exported agent domain → ${OUT}`)
  console.log(`  ${total}`)
}

main().catch((err) => {
  console.error(`✗ export failed: ${err.message}`)
  process.exit(1)
})
