#!/usr/bin/env node
/**
 * AIGENT-CORE-FACTORY-035 — restore of the agent domain from an export.
 *
 * Companion to export-agent-domain.mjs. Re-inserts the exported agent rows in
 * dependency order (parents first) so foreign keys resolve. This is what makes
 * the legacy purge REVERSIBLE: if the new core turns out wrong, this brings the
 * old copilots (and their versions/manifests/tools/runs/…) back exactly.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 * - Dry-run by DEFAULT. Nothing writes without --apply.
 * - Never touches CONTEXT tables (projects, mission_runs, mission_findings) —
 *   those are business data that the purge never removed, so a restore must not
 *   duplicate or overwrite them.
 * - Uses `Prefer: resolution=merge-duplicates` (upsert on primary key) so a
 *   partial restore can be re-run idempotently; a row that already exists is
 *   updated in place, never duplicated.
 * - Secrets come only from the environment and are never logged.
 *
 * Usage:
 *   node --env-file=.env.local scripts/restore-agent-domain.mjs                       # dry-run, default export path
 *   node --env-file=.env.local scripts/restore-agent-domain.mjs --in delivery/agent-domain/export.json
 *   node --env-file=.env.local scripts/restore-agent-domain.mjs --apply               # write
 */
import { readFileSync } from 'node:fs'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const inArg = argv.indexOf('--in')
const IN = inArg >= 0 ? argv[inArg + 1] : 'delivery/agent-domain/export.json'

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }

let payload
try {
  payload = JSON.parse(readFileSync(IN, 'utf8'))
} catch (err) {
  console.error(`✗ cannot read export ${IN}: ${err.message}`)
  process.exit(2)
}
if (!payload?.agent || !Array.isArray(payload?._meta?.agentTables)) {
  console.error('✗ export file is not an agent-domain-export (missing agent / _meta.agentTables)')
  process.exit(2)
}

const TABLES = payload._meta.agentTables // already in parent-first order

async function insertRows(table, rows) {
  if (rows.length === 0) return
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...H, Prefer: 'return=minimal,resolution=merge-duplicates' },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`POST ${table} -> ${res.status}`)
}

async function main() {
  console.log(apply ? 'RESTORE (apply)' : 'RESTORE (dry-run — pass --apply to write)')
  for (const t of TABLES) {
    const rows = payload.agent[t] ?? []
    if (!apply) {
      console.log(`  ${t}: ${rows.length} row(s) would be upserted`)
      continue
    }
    await insertRows(t, rows)
    console.log(`  ✓ ${t}: ${rows.length} row(s) upserted`)
  }
  console.log(apply ? '✓ restore complete' : 'dry-run complete — nothing written')
}

main().catch((err) => {
  console.error(`✗ restore failed: ${err.message}`)
  process.exit(1)
})
