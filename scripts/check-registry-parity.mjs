#!/usr/bin/env node
/**
 * REGISTRY PARITY GATE
 *
 * Since "LangGraph is mandatory for every agent", the LangGraph tool registry
 * (src/langgraph/tool-registry.mjs) is the ONLY registry that actually mounts
 * tools at run time. But availability is still derived from the direct path's
 * RUNNABLE_TOOL_NAMES (available-agents.ts), which mirrors TOOL_HANDLERS.
 *
 * When a tool exists in the direct registry but NOT in the LangGraph one, the
 * platform lies in the most dangerous way it can:
 *
 *   - the catalogue computes the agent `active` (its tools are "runnable"),
 *   - `buildToolsFromConfig` silently drops the unknown id (`if (!built)
 *     continue` — skip, never throw),
 *   - the agent runs, mounts nothing, and answers "no data" with
 *     tool_call_count = 0 while looking perfectly healthy.
 *
 * That is the exact failure this repo already paid for once (see the RUNTIME
 * comment in provision-tradeagent-roster.mjs). This gate makes it impossible
 * to reintroduce by asserting: every tool the direct path claims it can run
 * must be buildable by the LangGraph registry.
 *
 * Failing here is not a style issue — it means an agent using that tool would
 * be born broken and look fine.
 */
import { readFileSync } from 'node:fs'

const LANGGRAPH_REGISTRY = 'src/langgraph/tool-registry.mjs'
const FINANCE_TOOLS = 'src/lib/agent-mission-control/finance/tools.ts'
const MARKET_TOOLS = 'src/lib/agent-mission-control/market/tools.ts'

/** Keys of a top-level `const NAME = { … }` object literal, one indent deep. */
function objectKeys(source, declaration) {
  const block = source.match(new RegExp(`const ${declaration} = \\{([\\s\\S]*?)\\n\\}`))
  if (!block) return null
  return [...block[1].matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1])
}

/** Keys of an exported handler map, e.g. `export const X: Record<…> = { … }`. */
function handlerKeys(source, declaration) {
  const block = source.match(
    new RegExp(`export const ${declaration}[^=]*= \\{([\\s\\S]*?)\\n\\}`)
  )
  if (!block) return null
  return [...block[1].matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1])
}

const registrySource = readFileSync(LANGGRAPH_REGISTRY, 'utf8')
const marketIds = objectKeys(registrySource, 'MARKET_TOOL_SPECS')
const registryIds = objectKeys(registrySource, 'REGISTRY')

if (!marketIds || !registryIds) {
  console.error(
    `✗ Could not parse ${LANGGRAPH_REGISTRY} — MARKET_TOOL_SPECS / REGISTRY shape changed.`
  )
  console.error('  The gate cannot verify parity, so it fails rather than passing blindly.')
  process.exit(1)
}

// REGISTRY spreads MARKET_TOOL_IDS, so the union is what the graph can build.
const langgraphBuildable = new Set([...marketIds, ...registryIds])

const financeSource = readFileSync(FINANCE_TOOLS, 'utf8')
const marketSource = readFileSync(MARKET_TOOLS, 'utf8')
const financeHandlers = handlerKeys(financeSource, 'FINANCE_TOOL_HANDLERS')
const marketHandlers = handlerKeys(marketSource, 'TRADING_TOOL_HANDLERS')

if (!financeHandlers || !marketHandlers) {
  console.error('✗ Could not parse the direct-path handler maps — shape changed.')
  process.exit(1)
}

/**
 * Known gap, deliberately allowlisted rather than silently tolerated.
 *
 * The 9 finance handlers have no LangGraph counterpart. No finance copilot
 * exists in the database today, so nothing is broken right now — but creating
 * one would produce a silently toolless agent. Burn this down by either
 * registering the finance tools in tool-registry.mjs or removing the handlers.
 */
const KNOWN_GAP = new Set(financeHandlers)

const missing = []
for (const name of [...marketHandlers, ...financeHandlers]) {
  if (langgraphBuildable.has(name)) continue
  if (KNOWN_GAP.has(name)) continue
  missing.push(name)
}

const staleGap = [...KNOWN_GAP].filter((n) => langgraphBuildable.has(n))

// Bidirectional MARKET parity. The market-tools bridge route derives its
// allowlist from TRADING_TOOL_HANDLERS, and the graph mounts MARKET_TOOL_SPECS.
// If a tool is in the graph specs but NOT in the handlers (or vice versa), the
// model can call a mounted market tool that the bridge then 404s — the exact
// drift that hid read_funding_open_interest. Assert the two market sets match.
const marketSpecSet = new Set(marketIds)
const marketHandlerSet = new Set(marketHandlers)
const specOnly = [...marketSpecSet].filter((n) => !marketHandlerSet.has(n))
const handlerOnly = [...marketHandlerSet].filter((n) => !marketSpecSet.has(n))

let failed = false

if (specOnly.length > 0 || handlerOnly.length > 0) {
  failed = true
  console.error('\n✗ Market registry drift — the graph specs and the tool handlers disagree:\n')
  for (const n of specOnly) console.error(`  ${n}: mounted by the graph but has NO handler (bridge 404s it)`)
  for (const n of handlerOnly) console.error(`  ${n}: has a handler but the graph never mounts it`)
  console.error('\n  MARKET_TOOL_SPECS (tool-registry.mjs) and TRADING_TOOL_HANDLERS (market/tools.ts)')
  console.error('  must name the SAME market tools — the bridge allowlist is derived from the handlers.')
}

if (missing.length > 0) {
  failed = true
  console.error(`\n✗ ${missing.length} tool(s) runnable on the direct path but NOT buildable by the LangGraph registry:\n`)
  for (const name of missing) console.error(`  ${name}`)
  console.error(`\n  An agent declaring one of these mounts nothing and answers "no data"`)
  console.error(`  with tool_call_count = 0 while the catalogue reports it healthy.`)
  console.error(`  Fix: register it in ${LANGGRAPH_REGISTRY}, or drop the handler.`)
}

if (staleGap.length > 0) {
  failed = true
  console.error(`\n✗ ${staleGap.length} stale KNOWN_GAP entr(y/ies) — now buildable, remove from the allowlist:\n`)
  for (const name of staleGap) console.error(`  ${name}`)
}

if (failed) {
  console.error('\nRegistry-parity guard FAILED.\n')
  process.exit(1)
}

console.log(
  `✓ Registry-parity guard passed — every directly-runnable tool is buildable by the LangGraph graph.`
)
console.log(
  `  ${langgraphBuildable.size} buildable id(s); ${KNOWN_GAP.size} known gap(s) still allowlisted (debt, to burn down):`
)
console.log(
  `    finance handlers with no LangGraph counterpart — no finance copilot exists yet,`
)
console.log(`    but creating one today would yield a silently toolless agent.`)
