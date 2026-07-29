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
 *   - a tool with a missing/invalid classification field (kind, risk, mutates,
 *     requiresConfirmation, certification) — WHATEVER its certification state
 *   - the RUNTIME_REGISTRY key set ≠ the AgentRuntime union
 *
 * These are exactly the "sync N lists by hand" failures the reconstruction
 * removed. Failing here means an agent could be born broken (mounts nothing) or
 * a phantom runtime/tool could pass validation — never a style issue.
 *
 * The gate imports the canonical TS registry through a tiny compiled shim
 * (registry-snapshot) rather than parsing source, so it checks the REAL values.
 *
 * ── SONDE DU 26/07/2026 ─────────────────────────────────────────────────────
 * Sondée dans les deux sens : elle rougit bien sur un id fantôme du .mjs et sur
 * un membre retiré de l'union BehaviorToolId. Deux écarts corrigés ici :
 *   - L'en-tête annonçait « a tool published/certified » alors que le code ne
 *     testait QUE `certification === 'certified'`, et seulement kind/risk. Pire,
 *     le snapshot extrayait `mutates` et `requiresConfirmation` pour ne JAMAIS
 *     s'en servir : un outil destructeur sans confirmation passait. La règle est
 *     maintenant appliquée à tous les outils — le code rejoint l'en-tête.
 *   - Toutes les comparaisons étaient des boucles sur des ensembles : si l'un
 *     d'eux tombait à 0 (registre vide, union illisible, tsx renvoyant un
 *     JSON vide), les boucles devenaient vides et la gate sortait 0 « ✓ » sans
 *     avoir comparé quoi que ce soit. Chaque ensemble a désormais un compte
 *     minimal, et 0 élément ÉCHOUE.
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Racine déduite du script : une gate doit mesurer LE repo qu'elle garde, pas
// le dossier depuis lequel on l'a lancée.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const readSrc = (rel) => readFileSync(join(ROOT, rel), 'utf8')

const fail = (msg) => {
  console.error(`✗ ${msg}`)
  process.exitCode = 1
}

/**
 * Garde-fou anti-cécité. Un ensemble vide (ou plus petit que le minimum connu)
 * ne prouve rien : toutes les vérifications de cette gate sont des boucles, et
 * une boucle sur ∅ est verte par construction. On échoue AVANT de conclure.
 */
const MINIMUMS = { canonical: 22, executable: 22, behaviorUnion: 22, runtimes: 4, runtimeUnion: 4 }
const requireCount = (label, size) => {
  const min = MINIMUMS[label]
  if (size >= min) return true
  fail(
    `${label}: ${size} élément(s) indexé(s), minimum attendu ${min} — la gate ne mesure plus rien. ` +
      'Une gate qui indexe 0 élément doit ÉCHOUER, jamais passer en silence ' +
      '(mets le minimum à jour si un retrait est délibéré).'
  )
  return false
}

// ── 1. Load the executable registry ids (the real .mjs authority) ────────────
const { REGISTRY_IDS: MJS_IDS } = await import('../src/langgraph/tool-registry.mjs')
if (!Array.isArray(MJS_IDS)) {
  console.error('✗ src/langgraph/tool-registry.mjs n\'exporte plus REGISTRY_IDS — rien à comparer.')
  process.exit(1)
}
const mjsIds = new Set(MJS_IDS)
requireCount('executable', mjsIds.size)

// ── 2. Load the canonical TS registry values via tsx (real evaluation) ───────
// A one-shot script prints the canonical sets as JSON so we compare values, not
// regex-scraped source. tsx is already a dev dependency (used by npm scripts).
const snapshotSrc = `
import registry from './src/lib/agent-mission-control/registry/index.ts'
const { TOOL_IDS, TOOL_REGISTRY, RUNTIME_IDS, RUNTIME_REGISTRY, REGISTRY_HASH } = registry
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
  const out = execFileSync(process.execPath, ['--import', 'tsx', '--eval', snapshotSrc], {
    cwd: ROOT,
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
requireCount('canonical', canonicalIds.size)
requireCount('runtimes', snapshot.runtimeIds.length)

// ── 3. Tool id parity: canonical ⟺ executable .mjs ───────────────────────────
for (const id of snapshot.toolIds) {
  if (!mjsIds.has(id)) fail(`canonical tool "${id}" is NOT buildable by the executable REGISTRY (.mjs)`)
}
for (const id of mjsIds) {
  if (!canonicalIds.has(id)) fail(`executable REGISTRY tool "${id}" is NOT declared in the canonical registry`)
}

// ── 4. Tool id parity: canonical ⟺ BehaviorToolId union (source scan) ─────────
const behaviorSrc = readSrc('src/lib/agent-mission-control/copilot-behavior.ts')
const unionBlock = behaviorSrc.match(/export type BehaviorToolId =([\s\S]*?)\n\n/)
if (!unionBlock) {
  fail('could not locate the BehaviorToolId union in copilot-behavior.ts')
} else {
  const unionIds = new Set([...unionBlock[1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]))
  // Un bloc trouvé mais VIDE (union réécrite en `= string`, membres déplacés)
  // rendrait les deux boucles ci-dessous vacuously true dans un sens.
  requireCount('behaviorUnion', unionIds.size)
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
const RISKS = new Set(['low', 'medium', 'high'])
const CERTIFICATIONS = new Set(['certified', 'draft', 'deprecated'])
for (const t of snapshot.tools) {
  if (!t.version || !/^\d+\.\d+\.\d+$/.test(t.version)) fail(`tool "${t.id}" has a non-semver version "${t.version}"`)
  if (!Array.isArray(t.runtimes) || t.runtimes.length === 0) fail(`tool "${t.id}" declares no runtime`)
  for (const s of t.secretRefs || []) {
    if (!SECRET_REF.test(s)) fail(`tool "${t.id}" secretRef "${s}" is not an UPPER_SNAKE env reference`)
  }
  // La classification vaut pour TOUS les outils, pas seulement les certifiés :
  // c'est elle qui décide de la confirmation et de l'affichage du risque. Un
  // outil `draft` mal classé devient certifié plus tard sans que rien ne le relise.
  if (!t.kind) fail(`tool "${t.id}" has no kind`)
  if (!RISKS.has(t.risk)) fail(`tool "${t.id}" has an invalid risk "${t.risk}"`)
  if (typeof t.mutates !== 'boolean') fail(`tool "${t.id}" has a non-boolean mutates "${t.mutates}"`)
  if (typeof t.requiresConfirmation !== 'boolean') {
    fail(`tool "${t.id}" has a non-boolean requiresConfirmation "${t.requiresConfirmation}"`)
  }
  if (!CERTIFICATIONS.has(t.certification)) {
    fail(`tool "${t.id}" has an unknown certification "${t.certification}"`)
  }
  // Un outil qui ÉCRIT sans confirmation est la définition d'une action
  // destructive silencieuse. `mutates` et `requiresConfirmation` étaient tous
  // deux extraits par le snapshot et jamais lus — cette règle les utilise enfin.
  if (t.mutates === true && t.requiresConfirmation !== true) {
    fail(`tool "${t.id}" mutates state but does NOT require confirmation — a write with no human gate`)
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
const runtimeUnion = readSrc('src/lib/agent-mission-control/types.ts')
const rtBlock = runtimeUnion.match(/export type AgentRuntime =([\s\S]*?)\n\n/)
if (!rtBlock) {
  fail('could not locate the AgentRuntime union in types.ts')
} else {
  const rtIds = new Set([...rtBlock[1].matchAll(/'([a-z-]+)'/g)].map((m) => m[1]))
  requireCount('runtimeUnion', rtIds.size)
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
