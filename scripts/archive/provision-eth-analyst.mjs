#!/usr/bin/env node
/**
 * ETH Market Analyst — the first agent of the post-reset platform.
 *
 * Built on the same discipline as provision-tradeagent-roster.mjs (which this
 * deliberately mirrors rather than reinvents): an agent is only created when
 * every tool it declares has a REGISTERED HANDLER, it is born `draft`, and it
 * becomes `active` only through the official promotion path after a real run.
 *
 * ── Why ETH, and why an ANALYST ──────────────────────────────────────────────
 * The market factory is already ETH-first: `EXECUTABLE_PAIRS` in market/snapshot.ts
 * is ['ETHUSDT', 'ETHUSDC'] — ETH is the executable universe, BTC is context only.
 * An ETH specialist therefore sits exactly inside the covered perimeter instead
 * of straddling its edge.
 *
 * ── What this agent deliberately does NOT get ────────────────────────────────
 * `read_derivatives_snapshot` is EXCLUDED. Its provider (market/derivatives.ts)
 * hardcodes BTCUSDT in every Binance USD-M futures URL, so ETH funding and open
 * interest simply do not exist here. Until 2026-07-26 the tool silently answered
 * BTC data to an ETH question (its Zod schema stripped the unknown `pair` key);
 * that lie is now fixed — it returns UNAVAILABLE — but a fixed lie is still not
 * data. Mounting it would give this agent a tool that can only ever refuse, and
 * an agent whose toolbelt promises derivatives coverage it does not have is the
 * empty-shell pattern the roster script exists to prevent.
 *
 * So: 7 tools that genuinely resolve on ETH, and the prompt states the
 * derivatives gap outright instead of letting the model discover it mid-answer.
 *
 * ── Safety posture ───────────────────────────────────────────────────────────
 * Every mounted tool is a READ (market/tools.ts is GET-only). No write, trade,
 * transfer or withdrawal handler exists in the registry at all, so none can be
 * mounted. `mutates: false` is asserted EXPLICITLY on every row: the column
 * default is `true` (migration 0022, fail-closed), and omitting it is what made
 * the Agent Builder's read tools render as "CAN WRITE" — now caught by
 * `npm run check:tool-rows`.
 *
 * Idempotent: deterministic ids, upsert semantics. Re-running updates in place.
 * Secrets come from the environment and are never logged.
 *
 * Usage:
 *   node --env-file=.env.local scripts/provision-eth-analyst.mjs            # dry-run
 *   node --env-file=.env.local scripts/provision-eth-analyst.mjs --apply    # write
 */

const base = process.env.AMC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!base || !key) {
  console.error('✗ backend not configured (AMC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
  process.exit(2)
}

const apply = process.argv.includes('--apply')
const H = { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' }
const NOW = new Date().toISOString()

const PROJECT_ID = 'proj-tradeagent'
const MODEL = 'gpt-5.4'
const PROVIDER = 'openai'
/**
 * LangGraph is mandatory (AGENTS.md). The invariant is an ORDER, not a choice:
 * provision the assistant (scripts/ensure-langgraph-assistants.ts) and THEN run
 * on 'langgraph'. Without an assistant the graph falls back to its 5 legacy
 * generic tools and the agent answers "no data" with tool_call_count = 0 while
 * looking perfectly healthy.
 */
const RUNTIME = 'langgraph'
const OWNER = 'adrien@hearstcorporation.io'

const SLUG = 'eth-market-analyst'
const COPILOT_ID = `copilot-${SLUG}`
const MANIFEST_ID = `man-${SLUG}-v1`
const VERSION_ID = `ver-${SLUG}-v1`

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
 * The 6 tools that genuinely RETURN ETH DATA.
 *
 * Membership was decided by probing each handler live on ETHUSDT (2026-07-26),
 * not by reading its name. A tool that can only ever refuse is not coverage —
 * it is a promise the agent cannot keep, and it invites the model to burn a step
 * discovering that mid-answer.
 */
const TOOLS = [
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
  'read_macro_context',
]

/** Registered handlers (market/tools.ts TRADING_TOOL_HANDLERS + native reads). */
const RUNNABLE = new Set([
  'read_market_snapshot',
  'read_multi_timeframe_candles',
  'read_volatility_state',
  'read_market_structure',
  'read_liquidity_snapshot',
  'read_funding_open_interest',
  'read_derivatives_snapshot',
  'read_account_risk_snapshot',
  'read_macro_context',
])

const unresolved = TOOLS.filter((t) => !RUNNABLE.has(t))
if (unresolved.length > 0) {
  console.error(`✗ refusing to provision — no registered handler for: ${unresolved.join(', ')}`)
  process.exit(1)
}

const PROMPT =
  'You are ETH Market Analyst for TradeAgent — a specialist on Ethereum, and only Ethereum.\n\n' +
  'Your job: read the live ETH market with your tools and produce ONE actionable synthesis covering direction, ' +
  'market structure, volatility regime and liquidity quality. Cover the timeframes that matter for the question ' +
  'asked rather than dumping every interval.\n\n' +
  'PROVENANCE IS PART OF THE ANSWER. For every tool-backed fact, state the provider and how fresh the data is. ' +
  'A number without a source is not an answer.\n\n' +
  'YOUR UNIVERSE. ETHUSDT and ETHUSDC are executable and are your subject. BTC is CONTEXT ONLY — you may read it ' +
  'through read_macro_context to frame the ETH tape, but you never present BTC as a substitute for ETH, and you ' +
  'never answer an ETH question with BTC figures. Any other instrument (SOL, altcoins) is outside your coverage: ' +
  'say so plainly and name the pairs you do cover.\n\n' +
  'YOU HAVE NO DERIVATIVES DATA AT ALL — this is a spot-only desk. There is no ETH funding rate, no open interest, ' +
  'no perp positioning available to you: the spot provider has no perpetuals feed, and the derivatives provider is ' +
  'BTC-only. If asked about ETH funding, OI or perp positioning, say that data is unavailable on this platform and ' +
  'stop there. Do NOT substitute BTC derivatives, do NOT infer ETH positioning from BTC positioning, and do NOT ' +
  'derive a funding rate from spot prices.\n\n' +
  'UNAVAILABLE IS A VALID ANSWER. If a tool returns UNAVAILABLE, report it as unavailable. Never estimate, never ' +
  'backfill a gap with a plausible number, never present a computed guess as a reading. Saying "I do not have ' +
  'that" is always better than a confident invention.\n\n' +
  'You never place, size, modify or recommend the execution of an order. You describe the market — levels, ranges ' +
  'and measured conditions are analysis, not instructions to trade. Analysis only.'

const FORBIDDEN = [
  'place order',
  'modify position',
  'transfer funds',
  'withdraw funds',
  'write to any account',
  'present BTC data as ETH data',
  'estimate ETH funding or open interest from BTC derivatives',
]

const CONTRACT = {
  version: '1.0.0',
  fields: ['bias', 'structure', 'volatility', 'liquidity', 'provenance', 'freshness'],
  invariants: [
    'every tool-backed fact carries its provider and freshness',
    'ETH figures never sourced from a BTC instrument',
    'an unavailable input is reported, never estimated',
  ],
}

const VALID_PAIRS = '"ETHUSDT" | "ETHUSDC" | "BTCUSDT" | "BTCUSDC"'
const INTERVALS = '"1m" | "5m" | "15m" | "1h" | "4h" | "1d"'
/**
 * The description IS the input contract (AGENTS.md): the runner ships it to the
 * model with no JSON schema alongside. The Zod schemas expect `pair` — a vague
 * description makes the model guess `symbol` and every call fails.
 */
const TOOL_DESCRIPTIONS = {
  read_market_snapshot: `Read a full live ETH market snapshot (price, volume, spread, structure, volatility). Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: intervals (array of ${INTERVALS}), candleLimit (2-500).`,
  read_multi_timeframe_candles: `Read OHLCV candles across timeframes. Args: {"pair": ${VALID_PAIRS}, "intervals": [${INTERVALS}]} — both REQUIRED; the field is "pair", NOT "symbol". Optional: limit (2-100).`,
  read_volatility_state: `Read the volatility regime (ATR, stdev, annualized). Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: interval (${INTERVALS}), limit (15-500).`,
  read_market_structure: `Read trend and market structure (supports/resistances) per timeframe. Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: interval or intervals (${INTERVALS}), limit (15-100).`,
  read_liquidity_snapshot: `Read order-book depth, spread and liquidity quality. Args: {"pair": ${VALID_PAIRS}} — the field is "pair", NOT "symbol". Optional: depth (1-100).`,
  read_macro_context: `Read macro regime context (BTC tape + ETH). BTC here is CONTEXT ONLY, never a substitute for an ETH reading. Takes no required argument; call it with {}.`,
}

// Everything mounted is a read; none carries account scope.
const riskOf = (_name) => 'low'

console.log(`\nETH Market Analyst — first agent of the post-reset platform`)
console.log(`mode: ${apply ? 'APPLY' : 'DRY-RUN'}`)
console.log(`project: ${PROJECT_ID} · runtime: ${RUNTIME} · model: ${PROVIDER}/${MODEL}\n`)
console.log(`TOOLS (${TOOLS.length}) — all resolved against the registry`)
for (const t of TOOLS) console.log(`  ${t}`)
console.log(`\nDELIBERATELY EXCLUDED`)
console.log(`  read_derivatives_snapshot   BTC-only provider — no ETH funding/OI exists; a tool that could only refuse`)
console.log(`  read_funding_open_interest  binance-spot has no perp feed — probed live on ETH: always UNAVAILABLE`)
console.log(`  read_account_risk_snapshot  needs a connected account — always UNAVAILABLE, nothing to analyse`)

if (!apply) {
  console.log('\nDry-run only. Re-run with --apply to write.')
  process.exit(0)
}

const project = await (await req('GET', `projects?id=eq.${PROJECT_ID}&select=id`)).json()
if (project.length === 0) {
  console.error(`✗ project ${PROJECT_ID} does not exist — refusing to create an agent with no home`)
  process.exit(1)
}

/**
 * `copilots` and `copilot_versions` are under the promotion lockdown (0032/0033):
 * `service_role` lost the table-level UPDATE and only holds per-column grants
 * that EXCLUDE status / production_version_id / stage. An upsert
 * (`resolution=merge-duplicates`) compiles to INSERT … ON CONFLICT DO UPDATE over
 * every column in the payload, so PostgreSQL checks UPDATE on those protected
 * columns statically — even when the row does not exist. Result: 403 permission
 * denied. Same trap that broke restore-agent-domain.mjs; same resolution — insert
 * when missing, never attempt to overwrite a live promotion state from a script.
 */
async function insertIfMissing(table, row) {
  const found = await (await req('GET', `${table}?id=eq.${encodeURIComponent(row.id)}&select=id`)).json()
  if (found.length > 0) {
    console.log(`  ◦ ${table} ${row.id} already exists — left untouched (promotion state is RPC-owned)`)
    return false
  }
  await req('POST', table, row, 'return=minimal')
  return true
}

await insertIfMissing(
  'copilots',
  {
    id: COPILOT_ID,
    project_id: PROJECT_ID,
    name: 'ETH Market Analyst',
    slug: SLUG,
    description:
      'Ethereum specialist. Reads the live ETH market — price, structure, volatility, liquidity and macro tape — ' +
      'and produces one sourced, actionable synthesis. Never executes, never presents BTC data as ETH.',
    runtime: RUNTIME,
    status: 'draft', // proven-then-active; never born active
    production_version_id: null,
    latest_version_id: VERSION_ID,
    model: MODEL,
    model_provider: PROVIDER,
    owner: OWNER,
    tags: ['tradeagent', 'eth', 'analyst'],
    created_at: NOW,
    updated_at: NOW,
    health: {},
  }
)
console.log(`\n✓ copilot ${COPILOT_ID}`)

const toolIds = []
for (const name of TOOLS) {
  const toolId = `tool-${SLUG}-${name.replaceAll('_', '-')}`
  toolIds.push(toolId)
  await req(
    'POST',
    'tools',
    {
      id: toolId,
      copilot_id: COPILOT_ID,
      name,
      description: TOOL_DESCRIPTIONS[name],
      provider: 'internal',
      risk_level: riskOf(name),
      enabled: true,
      // Explicit: the column default is `true` (0022), and omitting it is what
      // made read tools render "CAN WRITE" — see check:tool-rows.
      mutates: false,
      requires_confirmation: false,
      scoped_routes: [],
    },
    'resolution=merge-duplicates,return=representation'
  )
}
console.log(`✓ ${toolIds.length} tools`)

await req(
  'POST',
  'manifests',
  {
    id: MANIFEST_ID,
    copilot_id: COPILOT_ID,
    version: 'v1.0.0',
    system_prompt_summary: PROMPT,
    allowed_routes: [],
    forbidden_actions: FORBIDDEN,
    confirmation_policy: 'risky-only',
    always_confirm_actions: ['place order', 'transfer funds', 'withdraw funds', 'liquidate position'],
    memory_sources: [],
    output_contract: CONTRACT,
    tool_ids: toolIds,
    max_steps_per_run: 8,
    max_cost_per_run_usd: 0.5,
    updated_at: NOW,
  },
  'resolution=merge-duplicates,return=representation'
)
console.log(`✓ manifest ${MANIFEST_ID}`)

await insertIfMissing(
  'copilot_versions',
  {
    id: VERSION_ID,
    copilot_id: COPILOT_ID,
    label: 'v1.0.0',
    stage: 'draft',
    manifest_id: MANIFEST_ID,
    model: MODEL,
    model_provider: PROVIDER,
    changelog: 'ETH Market Analyst — first agent provisioned after the 2026-07-26 platform reset.',
    created_at: NOW,
    created_by: OWNER,
    scores: {},
  }
)
console.log(`✓ version ${VERSION_ID}`)

console.log(
  `\n✓ provisioned as DRAFT. Next: ensure its LangGraph assistant, then run it for real.\n` +
    `  Activation goes through the promotion gate — never a direct status write (migration 0033).`
)
