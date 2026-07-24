#!/usr/bin/env node
/**
 * AIGENT-REALESTATE-001 — provision the real-estate valuation copilot.
 *
 * Creates ONE copilot in the existing `proj-real-estate-agent` project: the
 * valuation-agent from docs/projects/real-estate-agent/agents/valuation-agent.spec.md,
 * built ONLY from tools that actually resolve in the LangGraph registry
 * (src/langgraph/tool-registry.mjs) — the three read-only real-estate tools
 * this repo already ships and proved against live data:
 *
 *   resolve_address_to_section → BAN geocode + IGN cadastre (address → section)
 *   read_dvf_comparables       → DVF Etalab (signed sales, HISTORICAL)
 *   read_market_listings       → Apify portal listings (asking prices, FALLBACK)
 *
 * ── Why one agent, not five ──────────────────────────────────────────────────
 * The real-estate spec names five agents (valuation, prospection-market,
 * buyer-intelligence, crm-next-best-action, interview-api-sentinel). Only the
 * valuation-agent is buildable honestly today, because a copilot is only worth
 * creating when its tools resolve. The other four need handlers that do not
 * exist (CRM writes, buyer-intelligence sources, the interview sub-graph) —
 * creating them would be empty shells, which the doctrine forbids. They are
 * left unprovisioned and reported, not faked.
 *
 * ── Safety posture ───────────────────────────────────────────────────────────
 * Every mounted tool is a READ. There is no write/CRM/publish handler in the
 * registry, so none can be mounted (mirrors the market factory). The manifest
 * still declares forbidden_actions + a risky-only confirmation policy so any
 * future write handler is gated by default.
 *
 * Agent is created as `draft`. Activation is NOT automatic (spec §17: promotion
 * needs a real end-to-end run reviewed by a human). `active` must mean proven.
 *
 * ── The mandatory order ──────────────────────────────────────────────────────
 * runtime is 'langgraph' (mandatory). But a langgraph copilot with NO assistant
 * silently falls back to the 5 legacy generic tools and answers "no data" with
 * tool_call_count=0. So after --apply, run scripts/ensure-langgraph-assistants.ts
 * to provision the assistant (it carries the real tools/prompt/model into the
 * graph) — the copilot is only usable once that assistant exists.
 *
 * Idempotent: keyed on deterministic ids, upserts in place. Secrets from env,
 * never logged.
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-realestate-roster.mjs
 *   node --env-file=.env.local scripts/provision-realestate-roster.mjs --apply
 */

import { REALESTATE_TOOL_IDS } from '../src/langgraph/tool-registry.mjs'

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')

const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
const NOW = new Date().toISOString()

const PROJECT_ID = 'proj-real-estate-agent'
const MODEL = 'gpt-5.4'
const PROVIDER = 'openai'
const RUNTIME = 'langgraph'
const OWNER = 'adrien@hearstcorporation.io'

async function req(method, path, body, prefer) {
  const res = await fetch(`${base}/rest/v1/${path}`, {
    method,
    headers: {
      ...H,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      Prefer: prefer ?? (method === 'GET' ? 'count=exact' : 'return=representation'),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${(await res.text()).slice(0, 240)}`)
  }
  return res
}

// Per-tool descriptions shown to the operator (the model gets the registry's
// own descriptions; these are the human-facing summaries stored on the row).
const TOOL_DESCRIPTIONS = {
  resolve_address_to_section:
    'Resolve a French address to INSEE code + cadastral section (BAN + IGN cadastre). Read-only.',
  read_dvf_comparables:
    'Read confirmed DVF sales (signed prices, HISTORICAL) for a commune section. Read-only.',
  read_market_listings:
    'Read active portal listings (asking prices, FALLBACK) via Apify. Read-only.',
}
const RISK = {
  resolve_address_to_section: 'low',
  read_dvf_comparables: 'low',
  read_market_listings: 'medium', // scraped source, legal/ToS caveat
}

const ROSTER = [
  {
    slug: 'valuation-agent',
    name: 'Valuation Agent',
    description:
      'Produces a documented property valuation by crossing official signed sales (DVF), active market listings, and per-attribute adjustments — every figure carries its provenance, a missing datum is UNAVAILABLE, never invented. Read-only; never publishes without human approval.',
    tools: [
      'resolve_address_to_section',
      'read_dvf_comparables',
      'read_market_listings',
    ],
    prompt:
      'You are the Valuation Agent for the Real Estate Agent project. Given a property (address, surface, type), produce a documented value estimate. ' +
      'ALWAYS resolve the address to a cadastral section first (resolve_address_to_section), then read confirmed DVF sales (read_dvf_comparables — signed prices, HISTORICAL) and, when useful, active listings (read_market_listings — asking prices, FALLBACK). ' +
      'NEVER confuse an asking price (prix demandé) with a signed sale (prix signé). NEVER invent a comparable or a price: when a source returns UNAVAILABLE, say so and widen the range with caution. ' +
      'Every adjustment carries its amount and its justification. Prices are decimal strings. Always present the methodology and the comparables used. Never publish a report — a human approves first.',
    forbidden: [
      'publish a valuation report without human approval',
      'invent a cadastral value or a comparable when the source is UNAVAILABLE',
      'present an asking price as a signed sale',
      'write to any CRM or external system',
    ],
    contract:
      'A valuation with: central value + low/high range (decimal EUR strings), the comparables used with their provenance (DVF=HISTORICAL, listings=FALLBACK), the per-attribute adjustments (amount + justification), and any UNAVAILABLE source explicitly flagged.',
  },
]

// ── Guard: refuse to provision a tool the registry cannot build ──────────────
const RUNNABLE = new Set(REALESTATE_TOOL_IDS)
const bad = ROSTER.flatMap((a) => a.tools.filter((t) => !RUNNABLE.has(t)).map((t) => `${a.slug}: ${t}`))
if (bad.length > 0) {
  console.error('✗ refusing to provision — these tools have no registered handler:')
  for (const b of bad) console.error(`  - ${b}`)
  process.exit(1)
}

console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log(`project: ${PROJECT_ID} · provider: ${PROVIDER} · model: ${MODEL} · runtime: ${RUNTIME}\n`)
for (const a of ROSTER) {
  console.log(`  ${a.name.padEnd(20)} ${a.tools.length} tools, all resolved: ${a.tools.join(', ')}`)
}

if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to write.')
  console.log('After --apply: node --env-file=.env.local npx -y tsx scripts/ensure-langgraph-assistants.ts')
  process.exit(0)
}

// ── Verify the project exists (never create an agent with no home) ───────────
const project = await (await req('GET', `projects?id=eq.${PROJECT_ID}&select=id`)).json()
if (project.length === 0) {
  console.error(`✗ project ${PROJECT_ID} does not exist — refusing to create an agent with no home`)
  process.exit(1)
}

const created = []
for (const a of ROSTER) {
  const copilotId = `cop-${a.slug}`
  const manifestId = `man-${a.slug}-v1`
  const versionId = `ver-${a.slug}-v1`

  await req(
    'POST',
    'copilots',
    {
      id: copilotId,
      project_id: PROJECT_ID,
      name: a.name,
      slug: a.slug,
      description: a.description,
      runtime: RUNTIME,
      status: 'draft', // proven-then-active; never born active (spec §17)
      production_version_id: null,
      latest_version_id: versionId,
      model: MODEL,
      model_provider: PROVIDER,
      owner: OWNER,
      tags: ['real-estate', 'valuation', 'realestate-001'],
      created_at: NOW,
      updated_at: NOW,
      health: {},
    },
    'resolution=merge-duplicates,return=representation',
  )

  const toolIds = []
  for (const name of a.tools) {
    const toolId = `tool-${a.slug}-${name.replace(/_/g, '-')}`
    toolIds.push(toolId)
    await req(
      'POST',
      'tools',
      {
        id: toolId,
        copilot_id: copilotId,
        name,
        description: TOOL_DESCRIPTIONS[name] ?? `Read-only real-estate tool: ${name}`,
        provider: 'internal',
        risk_level: RISK[name] ?? 'low',
        enabled: true,
        // Every mounted tool is a READ (realestate/tools.ts is read-only). The
        // `mutates` column default is `true` (fail-closed), so assert false
        // EXPLICITLY or a re-provision would flip these back to write-capable.
        mutates: false,
        requires_confirmation: false,
        scoped_routes: [],
      },
      'resolution=merge-duplicates,return=representation',
    )
  }

  await req(
    'POST',
    'manifests',
    {
      id: manifestId,
      copilot_id: copilotId,
      version: 'v1.0.0',
      system_prompt_summary: a.prompt,
      allowed_routes: [],
      forbidden_actions: a.forbidden,
      confirmation_policy: 'risky-only',
      always_confirm_actions: ['publish report', 'write to CRM'],
      memory_sources: [],
      output_contract: a.contract,
      tool_ids: toolIds,
      max_steps_per_run: 10,
      max_cost_per_run_usd: 0.5,
      updated_at: NOW,
    },
    'resolution=merge-duplicates,return=representation',
  )

  await req(
    'POST',
    'copilot_versions',
    {
      id: versionId,
      copilot_id: copilotId,
      label: 'v1.0.0',
      stage: 'draft',
      manifest_id: manifestId,
      model: MODEL,
      model_provider: PROVIDER,
      changelog: 'Initial real-estate valuation copilot (AIGENT-REALESTATE-001).',
      created_at: NOW,
      created_by: OWNER,
      scores: {},
    },
    'resolution=merge-duplicates,return=representation',
  )

  created.push({ copilotId, name: a.name, tools: toolIds.length })
  console.log(`  ✓ ${a.name.padEnd(20)} ${copilotId} (${toolIds.length} tools)`)
}

// ── Verify by re-reading ─────────────────────────────────────────────────────
const check = await (
  await req(
    'GET',
    `copilots?project_id=eq.${PROJECT_ID}&select=id,name,runtime,status,model_provider`,
  )
).json()
console.log(`\n${created.length} copilot(s) written. Project now holds ${check.length}:`)
for (const c of check) {
  console.log(`  ${String(c.name).padEnd(20)} ${c.id} · ${c.runtime} · ${c.status} · ${c.model_provider}`)
}
console.log('\nNEXT (mandatory order — assistant BEFORE any run):')
console.log('  node --env-file=.env.local npx -y tsx scripts/ensure-langgraph-assistants.ts')
