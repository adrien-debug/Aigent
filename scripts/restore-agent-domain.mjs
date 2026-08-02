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
 *   node --env-file=.env.local scripts/restore-agent-domain.mjs --in .tmp/agent-domain-export.json
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
const IN = inArg >= 0 ? argv[inArg + 1] : '.tmp/agent-domain-export.json'

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

/**
 * Tables the promotion lockdown protects (migrations 0032/0033).
 *
 * 0033 REVOKED the table-level UPDATE on these from `service_role` and re-granted
 * every column EXCEPT the promotion-critical ones (`copilots.status`,
 * `copilots.production_version_id`, `copilot_versions.stage`), which only the
 * `aigent_promotion_executor` role may write, through the gated RPC.
 *
 * An upsert (`resolution=merge-duplicates`) compiles to INSERT … ON CONFLICT DO
 * UPDATE over EVERY column in the payload, so PostgreSQL checks UPDATE on the
 * protected columns STATICALLY — even when the row does not exist and no update
 * would ever run. Result: `POST copilots -> 403 permission denied`, and the
 * "reversible purge" this script exists to guarantee was silently NOT reversible
 * for the two tables that matter most. Found on 2026-07-26 restoring the Agent
 * Builder after a full reset.
 *
 * The fix keeps the lockdown intact rather than working around it: on these
 * tables a MISSING row is restored with a plain INSERT (legal — INSERT was never
 * revoked, and a restored row carries its exported `status`/`stage`, which the
 * 0032 trigger still refuses if it is a promoted state), and an EXISTING row is
 * SKIPPED and reported, because overwriting a live copilot's promotion state is
 * exactly what the lockdown forbids — that path is the RPC, never a bulk restore.
 */
const LOCKDOWN_TABLES = new Set(['copilots', 'copilot_versions'])

/** Ids already present in `table`, looked up in one bounded request. */
async function existingIds(table, ids) {
  if (ids.length === 0) return new Set()
  const inList = ids.map((id) => encodeURIComponent(id)).join(',')
  const res = await fetch(`${base}/rest/v1/${table}?select=id&id=in.(${inList})`, {
    headers: H,
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) throw new Error(`GET ${table} -> ${res.status}`)
  return new Set((await res.json()).map((r) => r.id))
}

async function post(table, rows, prefer) {
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...H, Prefer: prefer },
    body: JSON.stringify(rows),
    signal: AbortSignal.timeout(60000),
  })
  if (!res.ok) {
    // Never echo the raw body: it can carry schema internals.
    throw new Error(`POST ${table} -> ${res.status}`)
  }
}

/** Restore one table. Returns what actually happened, for honest reporting. */
async function insertRows(table, rows) {
  if (rows.length === 0) return { written: 0, skipped: [] }

  if (!LOCKDOWN_TABLES.has(table)) {
    // Unprotected table: the idempotent upsert is still the right tool.
    await post(table, rows, 'return=minimal,resolution=merge-duplicates')
    return { written: rows.length, skipped: [] }
  }

  const present = await existingIds(table, rows.map((r) => r.id))
  const fresh = rows.filter((r) => !present.has(r.id))
  const skipped = rows.filter((r) => present.has(r.id)).map((r) => r.id)
  // Plain INSERT, no ON CONFLICT: never asks for UPDATE on the protected columns.
  if (fresh.length > 0) await post(table, fresh, 'return=minimal')
  return { written: fresh.length, skipped }
}

async function main() {
  console.log(apply ? 'RESTORE (apply)' : 'RESTORE (dry-run — pass --apply to write)')
  for (const t of TABLES) {
    const rows = payload.agent[t] ?? []
    if (!apply) {
      const how = LOCKDOWN_TABLES.has(t) ? 'inserted if missing (lockdown table)' : 'upserted'
      console.log(`  ${t}: ${rows.length} row(s) would be ${how}`)
      continue
    }
    const { written, skipped } = await insertRows(t, rows)
    console.log(`  ✓ ${t}: ${written} row(s) written`)
    // A skip is never silent: an operator must know a row was left as-is, or
    // they would read "restore complete" as "everything is back".
    if (skipped.length > 0) {
      console.log(
        `    ⚠ ${skipped.length} already present, left untouched (promotion state is RPC-owned): ${skipped.join(', ')}`
      )
    }
  }
  console.log(apply ? '✓ restore complete' : 'dry-run complete — nothing written')
}

main().catch((err) => {
  console.error(`✗ restore failed: ${err.message}`)
  process.exit(1)
})
