#!/usr/bin/env node
/**
 * TOOL-ROW DRIFT GATE — the canonical registry vs the rows agents actually carry.
 *
 * AGENTS.md makes `src/lib/agent-mission-control/registry/` the single authority
 * for what a tool IS. `check:registry-integrity` and `check:registry-parity`
 * already defend that authority — but both compare CODE TO CODE. Nothing ever
 * compared the authority to the `tools` ROWS an agent is actually provisioned
 * with, and those rows are what the runtime confirmation gate and the UI read.
 *
 * So a row could contradict the registry indefinitely, in silence. It did:
 *
 *   Agent Builder Copilot, provisioned 2026-07-23 12:49 — its four read tools
 *   (read_project_summary, read_copilot_summary, read_recent_runs,
 *   read_tool_permissions) were written with `mutates: true`. The registry
 *   declares all four `mutates: false, kind: 'db-read'`. The authoring default
 *   that produced the bad value was fixed the SAME DAY at 22:18 (23b78de,
 *   "default read-only tools to mutates=false, not true") — nine hours later.
 *   The code was repaired; the rows already written stayed wrong, and no gate
 *   could see it.
 *
 * Why the drift is not cosmetic: `tools.mutates` is a SAFETY input. It feeds the
 * confirmation gate (authoring-writes.ts: `mutates === true || risk in
 * (high,critical) ⇒ requiresConfirmation`) and it renders as "CAN WRITE" in the
 * operator UI. A read-only tool mislabelled write-capable teaches operators to
 * approve prompts that mean nothing — and an operator trained to click through
 * confirmations is exactly how a real write slips by. The reverse drift (a real
 * write tool row saying `mutates:false`) is worse still: it would silently
 * disarm the confirmation gate.
 *
 * WHAT IS CHECKED, per `tools` row whose name exists in the canonical registry:
 *   mutates · risk_level · requires_confirmation
 * Rows whose name is NOT in the registry are reported as `unregistered` and are
 * NOT failures here — bespoke per-agent tools are legitimate, and the registry's
 * own coverage is `check:registry-integrity`'s job. One owner per rule.
 *
 * OFFLINE BY DEFAULT: with no gpu1 backend configured this exits 0 with a SKIP,
 * so `npm run check` stays runnable without credentials (same posture as the
 * live tests). Configure AMC_DATA_SOURCE=gpu1 + AMC_SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY to arm it. `--fix` rewrites drifted rows to the
 * registry's values (the registry is the authority; the row is the copy).
 *
 * Exit 0 = aligned or skipped, exit 1 = drift. Secrets are never logged.
 */
import { readFileSync } from 'node:fs'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = process.env.AMC_DATA_SOURCE === 'gpu1' && !!base && !!key
const fix = process.argv.includes('--fix')

if (!live) {
  console.log('◦ tool-row drift gate SKIPPED — no gpu1 backend configured (set AMC_DATA_SOURCE=gpu1).')
  process.exit(0)
}

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

/**
 * Parse the canonical tool definitions out of the registry SOURCE rather than
 * importing it: registry/tools.ts is TypeScript inside a Next app, and this gate
 * must run as a bare node script like every other check:* in this repo.
 *
 * Each entry is a `name: def({ … })` block; the three graded fields are read
 * from it. A def whose fields cannot all be read is reported as unparsed rather
 * than silently treated as absent — a gate that quietly stops checking is the
 * failure mode this whole file exists to prevent.
 */
function loadCanonicalTools() {
  const src = readFileSync('src/lib/agent-mission-control/registry/tools.ts', 'utf8')
  const out = new Map()
  const unparsed = []
  for (const m of src.matchAll(/^ {2}([a-z_0-9]+): def\(\{([\s\S]*?)^ {2}\}\),$/gm)) {
    const [, name, body] = m
    const mutates = body.match(/\bmutates:\s*(true|false)\b/)
    const risk = body.match(/\brisk:\s*'([a-z]+)'/)
    const confirm = body.match(/\brequiresConfirmation:\s*(true|false)\b/)
    if (!mutates || !risk || !confirm) {
      unparsed.push(name)
      continue
    }
    out.set(name, {
      mutates: mutates[1] === 'true',
      risk: risk[1],
      requiresConfirmation: confirm[1] === 'true',
    })
  }
  return { canonical: out, unparsed }
}

async function rest(method, path, body) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: H,
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  })
  // Never echo the raw body: it can carry schema internals.
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${res.status}`)
  return method === 'GET' ? res.json() : null
}

const { canonical, unparsed } = loadCanonicalTools()
if (canonical.size === 0) {
  console.error('✗ could not parse ANY tool from registry/tools.ts — the gate would pass vacuously.')
  process.exit(1)
}
if (unparsed.length > 0) {
  console.error(`✗ ${unparsed.length} registry def(s) missing a graded field: ${unparsed.join(', ')}`)
  process.exit(1)
}

const rows = await rest(
  'GET',
  'tools?select=id,copilot_id,name,mutates,risk_level,requires_confirmation&order=copilot_id,name'
)

const drifted = []
const unregistered = []
for (const row of rows) {
  const want = canonical.get(row.name)
  if (!want) {
    unregistered.push(row)
    continue
  }
  const deltas = []
  if (row.mutates !== want.mutates) deltas.push(['mutates', row.mutates, want.mutates])
  if (row.risk_level !== want.risk) deltas.push(['risk_level', row.risk_level, want.risk])
  if (row.requires_confirmation !== want.requiresConfirmation) {
    deltas.push(['requires_confirmation', row.requires_confirmation, want.requiresConfirmation])
  }
  if (deltas.length > 0) drifted.push({ row, want, deltas })
}

console.log(
  `Scanned ${rows.length} tool row(s) against ${canonical.size} canonical definition(s).` +
    (unregistered.length > 0 ? ` ${unregistered.length} not in the registry (not graded).` : '')
)

if (drifted.length === 0) {
  console.log('✓ Tool-row drift gate passed — every registered tool row matches the canonical registry.')
  process.exit(0)
}

console.error(`\n✗ ${drifted.length} tool row(s) contradict the canonical registry:\n`)
for (const { row, deltas } of drifted) {
  console.error(`  ${row.copilot_id} · ${row.name}  (${row.id})`)
  for (const [field, got, want] of deltas) console.error(`     ${field}: row=${got} → registry=${want}`)
}

if (!fix) {
  console.error(
    '\nThe registry is the authority (AGENTS.md); these rows are stale copies.' +
      '\nRe-run with --fix to align them, or correct registry/tools.ts if the ROW is right.'
  )
  process.exit(1)
}

for (const { row, want } of drifted) {
  await rest('PATCH', `tools?id=eq.${encodeURIComponent(row.id)}`, {
    mutates: want.mutates,
    risk_level: want.risk,
    requires_confirmation: want.requiresConfirmation,
  })
  console.log(`  ✓ aligned ${row.copilot_id} · ${row.name}`)
}
console.log(`\n✓ ${drifted.length} row(s) aligned to the canonical registry.`)
