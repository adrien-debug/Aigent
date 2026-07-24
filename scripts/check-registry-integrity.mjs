#!/usr/bin/env node
/**
 * REGISTRY INTEGRITY GATE (AIGENT-CORE-FACTORY-035, Phase 16).
 *
 * The canonical registry (src/lib/agent-mission-control/registry/) is now the
 * ONE authority for what tools and runtimes exist. This gate asserts that every
 * other place that enumerates a tool or runtime id is DERIVED from it and has
 * not drifted. It walks the whole registry and fails on any of:
 *
 *   - a canonical tool id NOT buildable by the executable REGISTRY (.mjs)
 *   - an executable REGISTRY id NOT declared in the canonical registry
 *   - a canonical tool id NOT present in the BehaviorToolId union
 *   - a runtime declared executable (engine ≠ none) with no real engine mapping
 *   - a duplicate id in any set
 *   - a tool declaring a secretRef that is not an UPPER_SNAKE env reference
 *   - a tool published/certified with a missing required field
 *   - the RUNTIME_REGISTRY key set ≠ the AgentRuntime union
 *
 * These are exactly the "sync N lists by hand" failures the reconstruction
 * removed. Failing here means an agent could be born broken (mounts nothing) or
 * a phantom runtime/tool could pass validation — never a style issue.
 *
 * The gate imports the canonical TS registry through a tiny compiled shim
 * (registry-snapshot) rather than parsing source, so it checks the REAL values.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

// ── 1. Load the executable registry ids (the real .mjs authority) ────────────
const { REGISTRY_IDS: MJS_IDS } = await import('../src/langgraph/tool-registry.mjs')
const mjsIds = new Set(MJS_IDS)

// ── 2. Load the canonical TS registry values via tsx (real evaluation) ───────
// A one-shot script prints the canonical sets as JSON so we compare values, not
// regex-scraped source. tsx is already a dev dependency (used by npm scripts).
const snapshotSrc = `
import { TOOL_IDS, TOOL_REGISTRY, RUNTIME_IDS, RUNTIME_REGISTRY, REGISTRY_HASH } from './src/lib/agent-mission-control/registry/index.ts'
const tools = TOOL_IDS.map((id) => {
  const t = TOOL_REGISTRY[id]
  return { id: t.id, version: t.version, kind: t.kind, mutates: t.mutates, risk: t.risk, requiresConfirmation: t.requiresConfirmation, secretRefs: t.secretRefs, certification: t.certification, runtimes: t.runtimes }
})
const runtimes = RUNTIME_IDS.map((id) => {
  const r = RUNTIME_REGISTRY[id]
  return { id: r.id, engine: r.engine, creatable: r.creatable }
})
process.stdout.write(JSON.stringify({ toolIds: TOOL_IDS, tools, runtimeIds: RUNTIME_IDS, runtimes, hash: REGISTRY_HASH }))
`
let snapshot
try {
  const out = execFileSync('npx', ['tsx', '--eval', snapshotSrc], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  snapshot = JSON.parse(out)
} catch (err) {
  console.error('✗ Could not evaluate the canonical registry via tsx.')
  console.error(String(err.stderr || err.message).slice(0, 800))
  process.exit(1)
}

const canonicalIds = new Set(snapshot.toolIds)

// ── 3. Tool id parity: canonical ⟺ executable .mjs ───────────────────────────
for (const id of snapshot.toolIds) {
  if (!mjsIds.has(id)) fail(`canonical tool "${id}" is NOT buildable by the executable REGISTRY (.mjs)`)
}
for (const id of mjsIds) {
  if (!canonicalIds.has(id)) fail(`executable REGISTRY tool "${id}" is NOT declared in the canonical registry`)
}

// ── 4. Tool id parity: canonical ⟺ BehaviorToolId union (source scan) ─────────
const behaviorSrc = readFileSync('src/lib/agent-mission-control/copilot-behavior.ts', 'utf8')
const unionBlock = behaviorSrc.match(/export type BehaviorToolId =([\s\S]*?)\n\n/)
if (!unionBlock) {
  fail('could not locate the BehaviorToolId union in copilot-behavior.ts')
} else {
  const unionIds = new Set([...unionBlock[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]))
  for (const id of snapshot.toolIds) {
    if (!unionIds.has(id)) fail(`canonical tool "${id}" is missing from the BehaviorToolId union`)
  }
  for (const id of unionIds) {
    if (!canonicalIds.has(id)) fail(`BehaviorToolId union has "${id}" with no canonical definition`)
  }
}

// ── 5. Duplicate ids ─────────────────────────────────────────────────────────
if (new Set(snapshot.toolIds).size !== snapshot.toolIds.length) fail('duplicate canonical tool id')
if (new Set(snapshot.runtimeIds).size !== snapshot.runtimeIds.length) fail('duplicate canonical runtime id')

// ── 6. Per-tool field integrity ──────────────────────────────────────────────
const SECRET_REF = /^[A-Z][A-Z0-9_]*$/
for (const t of snapshot.tools) {
  if (!t.version || !/^\d+\.\d+\.\d+$/.test(t.version)) fail(`tool "${t.id}" has a non-semver version "${t.version}"`)
  if (!Array.isArray(t.runtimes) || t.runtimes.length === 0) fail(`tool "${t.id}" declares no runtime`)
  for (const s of t.secretRefs || []) {
    if (!SECRET_REF.test(s)) fail(`tool "${t.id}" secretRef "${s}" is not an UPPER_SNAKE env reference`)
  }
  if (t.certification === 'certified' && (!t.kind || !t.risk)) {
    fail(`certified tool "${t.id}" is missing kind/risk`)
  }
}

// ── 7. Runtime engine integrity + union parity ───────────────────────────────
const REAL_ENGINES = new Set(['langgraph', 'model-router'])
for (const r of snapshot.runtimes) {
  if (r.engine !== 'none' && !REAL_ENGINES.has(r.engine)) {
    fail(`runtime "${r.id}" claims engine "${r.engine}" which is not a real engine`)
  }
  if (r.creatable && r.engine === 'none') {
    fail(`runtime "${r.id}" is creatable but has no engine (would let a phantom runtime be selected)`)
  }
}
const runtimeUnion = readFileSync('src/lib/agent-mission-control/types.ts', 'utf8')
const rtBlock = runtimeUnion.match(/export type AgentRuntime =([\s\S]*?)\n\n/)
if (!rtBlock) {
  fail('could not locate the AgentRuntime union in types.ts')
} else {
  const rtIds = new Set([...rtBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
  for (const id of snapshot.runtimeIds) {
    if (!rtIds.has(id)) fail(`RUNTIME_REGISTRY id "${id}" is not in the AgentRuntime union`)
  }
  for (const id of rtIds) {
    if (!snapshot.runtimeIds.includes(id)) fail(`AgentRuntime union member "${id}" has no RUNTIME_REGISTRY entry`)
  }
}

if (process.exitCode === 1) {
  console.error('\nRegistry-integrity gate FAILED — the canonical registry and a derived list disagree.')
  process.exit(1)
}

console.log('✓ Registry-integrity gate passed.')
console.log(`  ${snapshot.toolIds.length} tool(s), ${snapshot.runtimeIds.length} runtime(s) — canonical ⟺ executable ⟺ union.`)
console.log(`  registry hash: ${snapshot.hash}`)
