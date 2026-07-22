#!/usr/bin/env node
/**
 * AIGENT-RESET-TRADEAGENT-022 — provision the clean TradeAgent roster.
 *
 * Creates the new agent range from zero, after reset-agent-platform.mjs.
 * Every agent here is built from handlers that ACTUALLY EXIST in the runner's
 * registry — no tool is declared that cannot execute, so no agent can be born
 * with an unresolved tool.
 *
 * ── Why four agents and not six ──────────────────────────────────────────────
 * The target range names six responsibilities. Only four can be built honestly
 * today, because a copilot is only worth creating when its tools resolve:
 *
 *   Market Intelligence   → 5 market read handlers            ✓ buildable
 *   Portfolio Risk Guardian → risk + derivatives + volatility ✓ buildable
 *   Execution Supervisor  → liquidity/volatility pre-trade    ✓ buildable
 *   Performance Analyst   → market + macro context            ✓ buildable
 *
 *   Strategy Research     ✗ needs backtest handlers — none registered
 *   Withdrawal Review     ✗ needs account/withdrawal handlers — the only
 *                           account handler always returns UNAVAILABLE
 *                           ("account_required"), so the agent could never
 *                           reach a real APPROVE/REVIEW/BLOCK verdict.
 *
 * Creating those two would be creating empty shells, which the brief forbids.
 * They are left unprovisioned and reported, not faked.
 *
 * ── Safety posture ───────────────────────────────────────────────────────────
 * Every mounted tool is a READ. There is no write, trade, transfer or withdrawal
 * handler in the registry at all, so none can be mounted. Manifests still spell
 * out forbidden_actions and a risky-only confirmation policy, so the guardrail
 * refuses such a call even if a handler is added later.
 *
 * Agents are created as `draft`. Activation is NOT automatic: it happens only
 * after a real run succeeds (see --activate), because `active` must mean proven.
 *
 * Idempotent: keyed on deterministic ids. Re-running updates in place and never
 * duplicates. Secrets come from the environment and are never logged.
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-tradeagent-roster.mjs
 *   node --env-file=.env.local scripts/provision-tradeagent-roster.mjs --apply
 *   node --env-file=.env.local scripts/provision-tradeagent-roster.mjs --activate <copilotId>
 */

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured')
  process.exit(2)
}

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const activateIdx = argv.indexOf('--activate')
const activateId = activateIdx >= 0 ? argv[activateIdx + 1] : null

const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
const NOW = new Date().toISOString()

const PROJECT_ID = 'proj-tradeagent'
const MODEL = 'gpt-5.4'
const PROVIDER = 'openai'
/**
 * `openai-assistants` is the only value satisfying BOTH constraints, so it is
 * a deliberate choice, not a default:
 *
 *  - it must NOT be 'langgraph': runner.ts short-circuits that to the LangGraph
 *    Agent Server, which owns its own graph and tools. The manifest's market
 *    tools are never mounted, and the agent answers "I have no market data"
 *    while its five tools sit unused in the database. Observed, not theorised —
 *    the first proof runs came back with tool_call_count = 0.
 *  - it must be in available-agents' EXECUTABLE_RUNTIMES, else the catalogue
 *    derives `unavailable` and the execution gate refuses every run.
 *
 * The DB check constrains the column to langgraph|openai-assistants|gemini|
 * custom; 'custom' fails the catalogue check, 'gemini' would misdeclare the
 * provider. The name is historical: execution goes through the direct
 * model-router path, which reads the manifest and mounts TRADING_TOOL_HANDLERS.
 */
const RUNTIME = 'openai-assistants'
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
  if (!res.ok) throw new Error(`${method} ${path.split('?')[0]} -> ${res.status} ${(await res.text()).slice(0, 240)}`)
  return res
}

/**
 * The roster. `tools` lists MANIFEST TOOL NAMES that must exist in the runner's
 * registry — asserted below before anything is written.
 */
const ROSTER = [
  {
    slug: 'market-intelligence',
    name: 'Market Intelligence',
    description:
      'Reads live market state — price, volume, liquidity, volatility and structure — and produces one actionable synthesis. Never executes a trade.',
    tools: [
      'read_market_snapshot',
      'read_multi_timeframe_candles',
      'read_volatility_state',
      'read_market_structure',
      'read_liquidity_snapshot',
    ],
    prompt:
      'You are Market Intelligence for TradeAgent. Read the market with your tools and produce ONE actionable synthesis: direction, structure, volatility regime and liquidity quality. ' +
      'Always state the provider and the freshness of the data you used. If a tool returns UNAVAILABLE, say the data is unavailable — never estimate, never fill a gap with a plausible number. ' +
      'You never place, size, modify or recommend the execution of an order. Analysis only.',
    forbidden: ['place order', 'modify position', 'transfer funds', 'withdraw funds', 'write to any account'],
    contract: {
      version: '1.0.0',
      fields: ['bias', 'structure', 'volatility', 'liquidity', 'provenance', 'freshness'],
    },
  },
  {
    slug: 'portfolio-risk-guardian',
    name: 'Portfolio Risk Guardian',
    description:
      'Measures market-side risk: volatility regime, derivatives positioning and liquidity depth. Raises alerts and recommendations. Never liquidates or transfers.',
    tools: [
      'read_volatility_state',
      'read_derivatives_snapshot',
      'read_liquidity_snapshot',
      'read_market_snapshot',
      'read_account_risk_snapshot',
    ],
    prompt:
      'You are Portfolio Risk Guardian for TradeAgent. Assess risk from volatility, derivatives positioning and liquidity depth. Produce alerts with a severity and a concrete recommendation. ' +
      'read_account_risk_snapshot requires a connected account and will usually return UNAVAILABLE: when it does, say plainly that account-level exposure is unavailable and confine your assessment to market-side risk. ' +
      'NEVER invent a position, a balance, an exposure or a drawdown. You never liquidate, hedge, transfer or withdraw — you advise only.',
    forbidden: ['liquidate position', 'transfer funds', 'withdraw funds', 'place order', 'modify leverage'],
    contract: {
      version: '1.0.0',
      fields: ['riskLevel', 'alerts', 'recommendations', 'accountDataAvailable', 'provenance'],
    },
  },
  {
    slug: 'execution-supervisor',
    name: 'Execution Supervisor',
    description:
      'Reviews a proposed execution against live liquidity and volatility. Approves, flags or blocks. Never executes and never bypasses human approval.',
    tools: ['read_liquidity_snapshot', 'read_volatility_state', 'read_market_snapshot', 'read_market_structure'],
    prompt:
      'You are Execution Supervisor for TradeAgent. Given a proposed execution, check it against live liquidity depth, spread, volatility and market structure. ' +
      'Return APPROVE, FLAG or BLOCK with the concrete reason and the measured numbers behind it. Prefer BLOCK when the data needed to judge is unavailable — fail closed, never assume conditions are fine. ' +
      'You NEVER execute anything and you NEVER substitute yourself for human approval. You are a reviewer.',
    forbidden: ['place order', 'execute trade', 'bypass approval', 'transfer funds', 'withdraw funds'],
    contract: { version: '1.0.0', fields: ['verdict', 'reasons', 'measuredConditions', 'provenance'] },
  },
  {
    slug: 'performance-analyst',
    name: 'Performance Analyst',
    description:
      'Analyses market regime and macro context to explain performance conditions. Read-only; never changes a portfolio.',
    tools: ['read_market_snapshot', 'read_macro_context', 'read_volatility_state', 'read_multi_timeframe_candles'],
    prompt:
      'You are Performance Analyst for TradeAgent. Explain the conditions a strategy is operating in: regime, macro context, volatility and multi-timeframe trend. ' +
      'You do NOT have access to realised PnL, fills or account history — if asked for them, say that data is unavailable rather than estimating it. Never fabricate a return, a cost or an attribution. ' +
      'You never modify a portfolio or a strategy.',
    forbidden: ['modify portfolio', 'place order', 'transfer funds', 'change strategy parameters'],
    contract: { version: '1.0.0', fields: ['regime', 'macroContext', 'volatility', 'caveats', 'provenance'] },
  },
]

/** Responsibilities deliberately NOT provisioned, with the concrete blocker. */
const NOT_BUILDABLE = [
  {
    name: 'Strategy Research',
    reason: 'no backtest/universe handler is registered — the agent could not run a single hypothesis',
  },
  {
    name: 'Withdrawal Review',
    reason:
      'no withdrawal or balance handler exists; read_account_risk_snapshot always returns UNAVAILABLE (account_required), so no real APPROVE/REVIEW/BLOCK verdict is possible',
  },
]

// ── Assert every declared tool is actually runnable ──────────────────────────
const TRADING = [
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
  'read_funding_open_interest',
  'read_derivatives_snapshot',
  'read_account_risk_snapshot',
  'read_macro_context',
]
const NATIVE = [
  'read_project_summary',
  'read_copilot_summary',
  'read_recent_runs',
  'read_tool_permissions',
  'draft_copilot_spec',
]
const RUNNABLE = new Set([...TRADING, ...NATIVE])

const bad = ROSTER.flatMap((a) => a.tools.filter((t) => !RUNNABLE.has(t)).map((t) => `${a.slug}: ${t}`))
if (bad.length > 0) {
  console.error('✗ refusing to provision — these tools have no registered handler:')
  for (const b of bad) console.error(`    ${b}`)
  process.exit(1)
}

// Risk classification. Everything mounted is a read; account risk is the only
// one carrying account scope, so it is treated as the sensitive one.
const riskOf = (name) => (name === 'read_account_risk_snapshot' ? 'medium' : 'low')

/**
 * Tool descriptions MUST state the argument contract.
 *
 * The runner ships `tools.description` to the model as the whole tool spec —
 * there is no JSON schema alongside it. With a vague description the model
 * guesses field names, and market/tools.ts validates with a strict Zod object:
 * the first proof run called every tool with `{"symbol":"BTCUSDT"}` and got
 * `Invalid option: expected one of "BTCUSDT"|...` — confusing, because the
 * VALUE was valid; the FIELD (`pair`) was missing, so Zod reported the enum
 * failing on undefined. Naming the fields here is what makes the tools callable.
 *
 * Field names mirror the Zod schemas exactly. `read_derivatives_snapshot` is
 * the one that really does take `symbol`, and only the literal 'BTCUSDT'.
 */
const VALID_PAIRS = '"BTCUSDT" | "ETHUSDT" | "ETHUSDC" | "BTCUSDC"'
const INTERVALS = '"1m" | "5m" | "15m" | "1h" | "4h" | "1d"'
const TOOL_DESCRIPTIONS = {
  read_market_snapshot: `Read a full live market snapshot (price, volume, spread, structure, volatility). Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: intervals (array of ${INTERVALS}), candleLimit (2-500).`,
  read_multi_timeframe_candles: `Read OHLCV candles across timeframes. Args: {"pair": ${VALID_PAIRS}, "intervals": [${INTERVALS}]} — both REQUIRED; the field is "pair", NOT "symbol". Optional: limit (2-100).`,
  read_volatility_state: `Read the volatility regime (ATR, stdev). Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: interval (${INTERVALS}), limit (15-500).`,
  read_market_structure: `Read trend/market structure per timeframe. Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: interval or intervals (${INTERVALS}), limit (15-100).`,
  read_liquidity_snapshot: `Read order-book depth, spread and liquidity quality. Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: depth (1-100).`,
  read_derivatives_snapshot: `Read derivatives positioning (funding, open interest). Args: {"symbol": "BTCUSDT"} — optional, and BTCUSDT is the ONLY accepted value here.`,
  read_account_risk_snapshot: `Read account-level risk (positions, exposure, drawdown). Requires a connected TradeAgent account; returns UNAVAILABLE ("account_required") when none is connected — report that plainly, never estimate.`,
  read_macro_context: `Read macro regime context. Takes no required argument; call it with {}.`,
}

// ── --activate: promote a copilot only after a real run proved it ────────────
if (activateId) {
  const runs = await (
    await req(
      'GET',
      `agent_runs?copilot_id=eq.${encodeURIComponent(activateId)}&status=eq.completed&select=id,status,unsafe_attempt_count,resolved_model,model_unverified&order=started_at.desc&limit=1`
    )
  ).json()
  if (runs.length === 0) {
    console.error(`✗ ${activateId}: no completed run — activation refused (active must mean proven)`)
    process.exit(1)
  }
  const r = runs[0]
  if (r.unsafe_attempt_count > 0) {
    console.error(`✗ ${activateId}: last run had ${r.unsafe_attempt_count} unsafe attempt(s) — activation refused`)
    process.exit(1)
  }
  if (r.model_unverified !== false) {
    console.error(`✗ ${activateId}: last run did not prove its model — activation refused`)
    process.exit(1)
  }
  if (!apply) {
    console.log(`DRY-RUN: would activate ${activateId} (run ${r.id}, model ${r.resolved_model})`)
    process.exit(0)
  }
  await req('PATCH', `copilots?id=eq.${encodeURIComponent(activateId)}`, { status: 'active', updated_at: NOW })
  console.log(`✓ activated ${activateId} — proven by run ${r.id} on ${r.resolved_model}`)
  process.exit(0)
}

// ── Provision ────────────────────────────────────────────────────────────────
console.log(`\nAIGENT-RESET-TRADEAGENT-022 — provision clean TradeAgent roster`)
console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log(`project: ${PROJECT_ID} · provider: ${PROVIDER} · model: ${MODEL}\n`)

console.log(`TO PROVISION (${ROSTER.length})`)
for (const a of ROSTER) console.log(`  ${a.name.padEnd(26)} ${a.tools.length} tools, all resolved`)
console.log(`\nNOT BUILDABLE (${NOT_BUILDABLE.length}) — reported, never faked`)
for (const n of NOT_BUILDABLE) console.log(`  ${n.name.padEnd(26)} ${n.reason}`)

if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to write.')
  process.exit(0)
}

const project = await (await req('GET', `projects?id=eq.${PROJECT_ID}&select=id`)).json()
if (project.length === 0) {
  console.error(`✗ project ${PROJECT_ID} does not exist — refusing to create agents with no home`)
  process.exit(1)
}

const created = []
for (const a of ROSTER) {
  const copilotId = `copilot-${a.slug}`
  const manifestId = `man-${a.slug}-v1`
  const versionId = `ver-${a.slug}-v1`

  // copilots first: every child FKs to it.
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
      status: 'draft', // proven-then-active; never born active
      production_version_id: null,
      latest_version_id: versionId,
      model: MODEL,
      model_provider: PROVIDER,
      owner: OWNER,
      tags: ['tradeagent', 'reset-022'],
      created_at: NOW,
      updated_at: NOW,
      health: {},
    },
    'resolution=merge-duplicates,return=representation'
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
        description: TOOL_DESCRIPTIONS[name] ?? `Read-only market tool: ${name}`,
        provider: 'internal',
        risk_level: riskOf(name),
        enabled: true,
        // Everything mounted is a read, so nothing needs confirmation today.
        // The manifest still declares risky-only, so a future write handler is
        // gated by default rather than inheriting a permissive setting.
        requires_confirmation: false,
        scoped_routes: [],
      },
      'resolution=merge-duplicates,return=representation'
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
      always_confirm_actions: ['place order', 'transfer funds', 'withdraw funds', 'liquidate position'],
      memory_sources: [],
      output_contract: a.contract,
      tool_ids: toolIds,
      max_steps_per_run: 8,
      max_cost_per_run_usd: 0.5,
      updated_at: NOW,
    },
    'resolution=merge-duplicates,return=representation'
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
      changelog: 'Initial clean roster (AIGENT-RESET-TRADEAGENT-022).',
      created_at: NOW,
      created_by: OWNER,
      scores: {},
    },
    'resolution=merge-duplicates,return=representation'
  )

  created.push({ copilotId, name: a.name, tools: toolIds.length })
  console.log(`  ✓ ${a.name.padEnd(26)} ${copilotId} (${toolIds.length} tools)`)
}

// ── Verify by re-reading ─────────────────────────────────────────────────────
const cop = await (await req('GET', `copilots?project_id=eq.${PROJECT_ID}&select=id,name,status`)).json()
const tools = await (await req('GET', 'tools?select=id')).json()
const mans = await (await req('GET', 'manifests?select=id')).json()
const vers = await (await req('GET', 'copilot_versions?select=id')).json()

console.log(`\nAFTER`)
console.log(`  copilots (${PROJECT_ID})  ${cop.length}`)
console.log(`  tools                     ${tools.length}`)
console.log(`  manifests                 ${mans.length}`)
console.log(`  versions                  ${vers.length}`)

if (cop.length !== ROSTER.length) {
  console.error(`\n✗ expected ${ROSTER.length} copilots, found ${cop.length}`)
  process.exit(1)
}
console.log('\n✓ roster provisioned — all tools resolved, all agents draft pending proof.')
