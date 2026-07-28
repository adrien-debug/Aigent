#!/usr/bin/env node
/**
 * TOOL-DEFINITIONS GATE — registry authority vs `tool_definitions` catalogue +
 * mount FK coverage on `tools.tool_definition_id`.
 *
 * Complements `check:tool-rows` (which grades mount rows against the registry).
 * This gate asserts:
 *   1. Every registry tool has a matching `tool_definitions` row (mutates, risk, kind).
 *   2. Every `tools` mount references a catalogue row via `tool_definition_id`.
 *
 * Offline by default (exit 0 SKIP) when gpu1 is not configured — same posture as
 * `check:tool-rows`. `--fix` upserts missing/stale catalogue rows from the registry
 * and backfills null `tool_definition_id` on mounts.
 */
import { readFileSync } from 'node:fs'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
const live = process.env.AMC_DATA_SOURCE === 'gpu1' && !!base && !!key
const fix = process.argv.includes('--fix')

if (!live) {
  console.log('◦ tool-definitions gate SKIPPED — no gpu1 backend configured (set AMC_DATA_SOURCE=gpu1).')
  process.exit(0)
}

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

function parseQuotedField(body, field) {
  const single = body.match(new RegExp(`\\b${field}:\\s*'((?:\\\\'|[^'])*)'`))
  if (single) return single[1].replace(/\\'/g, "'")
  const double = body.match(new RegExp(`\\b${field}:\\s*"((?:\\\\"|[^"])*)"`))
  if (double) return double[1].replace(/\\"/g, '"')
  return null
}

function loadCanonicalTools() {
  const src = readFileSync('src/lib/agent-mission-control/registry/tools.ts', 'utf8')
  const out = new Map()
  const unparsed = []
  for (const m of src.matchAll(/^ {2}([a-z_0-9]+): def\(\{([\s\S]*?)^ {2}\}\),$/gm)) {
    const [, name, body] = m
    const mutates = body.match(/\bmutates:\s*(true|false)\b/)
    const risk = body.match(/\brisk:\s*'([a-z]+)'/)
    const kind = body.match(/\bkind:\s*'([a-z-]+)'/)
    const summary = parseQuotedField(body, 'summary')
    const certification = body.match(/\bcertification:\s*'([a-z]+)'/)
    if (!mutates || !risk || !kind || !summary || !certification) {
      unparsed.push(name)
      continue
    }
    out.set(name, {
      mutates: mutates[1] === 'true',
      risk: risk[1],
      kind: kind[1],
      summary,
      certification: certification[1],
    })
  }
  return { canonical: out, unparsed }
}

async function rest(method, path, body, prefer) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: { ...H, ...(prefer ? { Prefer: prefer } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    const text = await res.text()
    if (res.status === 404 && text.includes('tool_definitions')) {
      throw new Error(
        'tool_definitions table missing — apply supabase/migrations/0041_tool_definitions_catalog.sql first'
      )
    }
    throw new Error(`${method} ${path.split('?')[0]} -> ${res.status}`)
  }
  return method === 'GET' ? res.json() : null
}

const { canonical, unparsed } = loadCanonicalTools()
if (canonical.size === 0) {
  console.error('✗ could not parse ANY tool from registry/tools.ts')
  process.exit(1)
}
if (unparsed.length > 0) {
  console.error(`✗ ${unparsed.length} registry def(s) missing a graded field: ${unparsed.join(', ')}`)
  process.exit(1)
}

let defs
try {
  defs = await rest('GET', 'tool_definitions?select=id,name,mutates,risk_level,kind,certification')
} catch (e) {
  console.error(`✗ ${e.message}`)
  process.exit(1)
}

const defById = new Map(defs.map((d) => [d.id, d]))
const missingDefs = []
const driftedDefs = []

for (const [id, want] of canonical) {
  const row = defById.get(id)
  if (!row) {
    missingDefs.push({ id, want })
    continue
  }
  const deltas = []
  if (row.mutates !== want.mutates) deltas.push(['mutates', row.mutates, want.mutates])
  if (row.risk_level !== want.risk) deltas.push(['risk_level', row.risk_level, want.risk])
  if (row.kind !== want.kind) deltas.push(['kind', row.kind, want.kind])
  if (row.certification !== want.certification) {
    deltas.push(['certification', row.certification, want.certification])
  }
  if (deltas.length > 0) driftedDefs.push({ id, deltas })
}

const mounts = await rest(
  'GET',
  'tools?select=id,name,tool_definition_id&order=name'
)
const mountsMissingFk = mounts.filter((m) => !m.tool_definition_id)

console.log(
  `Catalogue: ${defs.length} row(s) in DB, ${canonical.size} in registry.` +
    ` Mounts: ${mounts.length}, missing FK: ${mountsMissingFk.length}.`
)

const failed =
  missingDefs.length > 0 || driftedDefs.length > 0 || mountsMissingFk.length > 0

if (!failed) {
  console.log('✓ Tool-definitions gate passed — catalogue aligned and every mount has tool_definition_id.')
  process.exit(0)
}

if (missingDefs.length > 0) {
  console.error(`\n✗ ${missingDefs.length} registry tool(s) missing from tool_definitions:`)
  for (const { id } of missingDefs) console.error(`     ${id}`)
}

if (driftedDefs.length > 0) {
  console.error(`\n✗ ${driftedDefs.length} catalogue row(s) drift from registry:`)
  for (const { id, deltas } of driftedDefs) {
    console.error(`  ${id}`)
    for (const [field, got, want] of deltas) console.error(`     ${field}: db=${got} → registry=${want}`)
  }
}

if (mountsMissingFk.length > 0) {
  console.error(`\n✗ ${mountsMissingFk.length} mount(s) missing tool_definition_id:`)
  for (const m of mountsMissingFk.slice(0, 20)) {
    console.error(`     ${m.id} · ${m.name}`)
  }
  if (mountsMissingFk.length > 20) console.error(`     … and ${mountsMissingFk.length - 20} more`)
}

if (!fix) {
  console.error('\nRe-run with --fix to upsert catalogue rows and backfill mount FKs.')
  process.exit(1)
}

const upsertRows = [...canonical.entries()].map(([id, want]) => ({
  id,
  name: id,
  description: want.summary,
  provider: 'internal',
  risk_level: want.risk,
  mutates: want.mutates,
  version: '1.0.0',
  certification: want.certification,
  provenance: 'platform',
  kind: want.kind,
  updated_at: new Date().toISOString(),
}))
await rest('POST', 'tool_definitions', upsertRows, 'resolution=merge-duplicates,return=minimal')
console.log(`  ✓ upserted ${upsertRows.length} catalogue row(s)`)

for (const m of mountsMissingFk) {
  await rest('PATCH', `tools?id=eq.${encodeURIComponent(m.id)}`, { tool_definition_id: m.name })
}
if (mountsMissingFk.length > 0) {
  console.log(`  ✓ backfilled tool_definition_id on ${mountsMissingFk.length} mount(s)`)
}

console.log('\n✓ Tool-definitions gate fixed.')
process.exit(0)
