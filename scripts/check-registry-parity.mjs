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
 *
 * ── SONDE DU 26/07/2026 : deux défauts mesurés, corrigés ici ────────────────
 *
 * 1. CÉCITÉ SUR TOUTE UNE FAMILLE D'OUTILS. `RUNNABLE_TOOL_NAMES` est l'union
 *    de NATIVE_TOOL_NAMES + TRADING_TOOL_HANDLERS + REALESTATE_TOOL_HANDLERS.
 *    La gate ne comparait QUE les handlers trading, contre un ensemble
 *    « buildable » recomposé à la main (MARKET_TOOL_SPECS ∪ clés littérales de
 *    REGISTRY) qui OUBLIAIT les ids immobiliers étalés par
 *    `...REALESTATE_TOOL_IDS`. Preuve : un handler fantôme `read_flood_risk`
 *    ajouté à REALESTATE_TOOL_HANDLERS — donc runnable côté catalogue, monté
 *    par rien côté graphe — laissait la gate VERTE. C'est précisément la panne
 *    qu'elle existe pour empêcher, sur une famille entière.
 *    → l'ensemble buildable vient maintenant du module lui-même (REGISTRY_IDS
 *      importé, valeurs RÉELLES), et les trois familles sont comparées.
 *
 * 2. CÉCITÉ PAR PARSING. `objectKeys`/`handlerKeys` renvoyaient `[]` — et non
 *    `null` — dès que l'indentation des clés changeait, et ∅ vs ∅ passait pour
 *    de la parité. Preuve : les mêmes ids ré-indentés d'un cran faisaient
 *    tomber le compte de 19 à 10 buildable ids… avec un ✓ vert. C'est la
 *    cécité de `check:class-collision` rejouée à l'identique.
 *    → tout ensemble parsé a désormais un compte attendu minimal ; 0 élément
 *      (ou moins que le minimum) ÉCHOUE avec un message explicite.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// La racine vient du script, pas du cwd : une gate doit mesurer LE repo qu'elle
// garde même lancée depuis un sous-dossier.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const LANGGRAPH_REGISTRY = 'src/langgraph/tool-registry.mjs'
const MARKET_TOOLS = 'src/lib/agent-mission-control/market/tools.ts'
const REALESTATE_TOOLS = 'src/lib/agent-mission-control/realestate/tools.ts'
const AVAILABLE_AGENTS = 'src/lib/agent-mission-control/available-agents.ts'

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

let failed = false
const fail = (lines) => {
  failed = true
  for (const line of lines) console.error(line)
}

// ── 1. Côté LangGraph : les VALEURS réelles, pas un regex ────────────────────
// Le module s'importe (check:registry-integrity le fait déjà) et expose sa
// propre vérité. Importer supprime d'un coup toute la classe de cécité liée au
// parsing du côté graphe : plus d'indentation, plus de spread oublié.
const registryModule = await import('../src/langgraph/tool-registry.mjs')
const { REGISTRY_IDS, MARKET_TOOL_IDS, REALESTATE_TOOL_IDS } = registryModule

for (const [name, value] of Object.entries({ REGISTRY_IDS, MARKET_TOOL_IDS, REALESTATE_TOOL_IDS })) {
  if (!Array.isArray(value)) {
    const reason = typeof value === 'undefined' ? 'absent' : 'invalide'
    console.error(`✗ ${LANGGRAPH_REGISTRY} n'exporte plus un ${name} exploitable (${reason}).`)
    console.error('  La gate ne peut rien vérifier — elle échoue plutôt que de passer à l\'aveugle.')
    process.exit(1)
  }
  if (value.length === 0) {
    console.error(`✗ ${LANGGRAPH_REGISTRY} n'exporte plus un ${name} exploitable (vide).`)
    console.error('  La gate ne peut rien vérifier — elle échoue plutôt que de passer à l\'aveugle.')
    process.exit(1)
  }
}

const langgraphBuildable = new Set(REGISTRY_IDS)

// ── 2. Côté direct : parsing de source, borné par un compte minimal ──────────
/** Keys of an exported handler map, e.g. `export const X: Record<…> = { … }`. */
function sliceBalancedBlock(source, openBraceIndex) {
  let depth = 0
  for (let i = openBraceIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(openBraceIndex + 1, i)
    }
  }
  return null
}

function sliceBalancedBracket(source, openBracketIndex) {
  let depth = 0
  for (let i = openBracketIndex; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) return source.slice(openBracketIndex + 1, i)
    }
  }
  return null
}

function handlerKeys(source, declaration) {
  const marker = `export const ${declaration}`
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) return null
  const braceIndex = source.indexOf('{', markerIndex)
  if (braceIndex === -1) return null
  const block = sliceBalancedBlock(source, braceIndex)
  if (!block) return null
  return [...block.matchAll(/^\s{2}([a-z_0-9]+):/gm)].map((m) => m[1])
}

/** Elements of a `const NAME = [ 'a', 'b' ] as const` string-literal array. */
function literalArray(source, declaration) {
  const marker = `const ${declaration} = [`
  const markerIndex = source.indexOf(marker)
  if (markerIndex === -1) return null
  const bracketIndex = source.indexOf('[', markerIndex)
  if (bracketIndex === -1) return null
  const block = sliceBalancedBracket(source, bracketIndex)
  if (!block) return null
  return [...block.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1])
}

/**
 * Un ensemble parsé sous son minimum attendu = la forme du fichier a changé et
 * la gate ne lit plus ce qu'elle croit lire. Elle doit échouer BRUYAMMENT :
 * comparer deux ensembles vides et annoncer « parité » est le mensonge exact
 * qui a rendu check:class-collision aveugle.
 */
function requireSet(ids, { declaration, file, min }) {
  if (ids === null) {
    fail([
      `✗ Impossible de parser ${declaration} dans ${file} — la forme de la déclaration a changé.`,
      '  La gate ne peut pas vérifier la parité, donc elle échoue au lieu de passer à l\'aveugle.',
    ])
    return []
  }
  if (ids.length < min) {
    fail([
      `✗ ${declaration} (${file}) n'indexe que ${ids.length} id(s), minimum attendu ${min}.`,
      '  Soit des outils ont été supprimés sans mettre ce minimum à jour, soit — bien pire —',
      '  l\'indentation/la forme a changé et le parsing ne voit plus rien : une gate qui indexe',
      '  0 élément passerait « verte » en ne comparant que du vide.',
    ])
    return ids
  }
  return ids
}

const marketSource = read(MARKET_TOOLS)
const realestateSource = read(REALESTATE_TOOLS)
const availableSource = read(AVAILABLE_AGENTS)

// Minimums = l'état constaté au 26/07/2026. Retirer un outil est légitime, mais
// cela doit être un geste EXPLICITE (baisser le minimum ici), jamais un effet
// de bord silencieux d'un reformatage.
const marketHandlers = requireSet(handlerKeys(marketSource, 'TRADING_TOOL_HANDLERS'), {
  declaration: 'TRADING_TOOL_HANDLERS', file: MARKET_TOOLS, min: 9,
})
const realestateHandlers = requireSet(handlerKeys(realestateSource, 'REALESTATE_TOOL_HANDLERS'), {
  declaration: 'REALESTATE_TOOL_HANDLERS', file: REALESTATE_TOOLS, min: 3,
})
const nativeNames = requireSet(literalArray(availableSource, 'NATIVE_TOOL_NAMES'), {
  declaration: 'NATIVE_TOOL_NAMES', file: AVAILABLE_AGENTS, min: 5,
})

// available-agents.ts compose RUNNABLE_TOOL_NAMES à partir de ces trois sources.
// Si un jour il en ajoute une quatrième, la gate cesserait de couvrir la totalité
// du set sans le dire — donc on vérifie que la composition est bien celle-là.
const RUNNABLE_COMPOSITION = /new Set<string>\(\[([\s\S]*?)\]\)/
const composition = availableSource.match(RUNNABLE_COMPOSITION)
if (!composition) {
  fail([
    `✗ Impossible de localiser la composition de RUNNABLE_TOOL_NAMES dans ${AVAILABLE_AGENTS}.`,
    '  La gate ne sait plus quelles sources composent le set runnable — elle échoue.',
  ])
} else {
  const spread = [...composition[1].matchAll(/\.\.\.(?:Object\.keys\()?([A-Z_][A-Z_0-9]*)/g)].map((m) => m[1])
  const KNOWN = new Set(['NATIVE_TOOL_NAMES', 'TRADING_TOOL_HANDLERS', 'REALESTATE_TOOL_HANDLERS'])
  const unknown = spread.filter((s) => !KNOWN.has(s))
  const missing = [...KNOWN].filter((k) => !spread.includes(k))
  if (unknown.length > 0 || missing.length > 0) {
    fail([
      '\n✗ RUNNABLE_TOOL_NAMES ne se compose plus des sources que cette gate vérifie :',
      ...unknown.map((s) => `  ${s} : source NON couverte par la gate (famille d'outils entière non vérifiée)`),
      ...missing.map((s) => `  ${s} : la gate la vérifie mais le set runnable ne l'utilise plus`),
      '  C\'est exactement le trou mesuré le 26/07 : la famille immobilière était runnable',
      '  côté catalogue et invisible pour cette gate. Mets KNOWN à jour ET ajoute la parité.',
    ])
  }
}

// ── 3. Parité par famille (bidirectionnelle) ─────────────────────────────────
/**
 * La route pont dérive son allowlist des HANDLERS et le graphe monte les SPECS.
 * Un id d'un seul côté = soit un outil monté que le pont 404, soit un handler
 * que le modèle ne peut jamais appeler. Les deux sens comptent.
 */
function assertFamilyParity({ family, specIds, handlerIds, specSource, handlerSource }) {
  const specSet = new Set(specIds)
  const handlerSet = new Set(handlerIds)
  const specOnly = [...specSet].filter((n) => !handlerSet.has(n))
  const handlerOnly = [...handlerSet].filter((n) => !specSet.has(n))
  if (specOnly.length === 0 && handlerOnly.length === 0) return
  fail([
    `\n✗ Dérive du registre ${family} — les specs du graphe et les handlers ne s'accordent pas :\n`,
    ...specOnly.map((n) => `  ${n}: monté par le graphe mais SANS handler (le pont le 404)`),
    ...handlerOnly.map((n) => `  ${n}: a un handler mais le graphe ne le monte jamais`),
    `\n  ${specSource} et ${handlerSource} doivent nommer LES MÊMES outils ${family} —`,
    '  l\'allowlist du pont est dérivée des handlers.',
  ])
}

assertFamilyParity({
  family: 'MARKET',
  specIds: MARKET_TOOL_IDS,
  handlerIds: marketHandlers,
  specSource: `MARKET_TOOL_SPECS (${LANGGRAPH_REGISTRY})`,
  handlerSource: `TRADING_TOOL_HANDLERS (${MARKET_TOOLS})`,
})

assertFamilyParity({
  family: 'REALESTATE',
  specIds: REALESTATE_TOOL_IDS,
  handlerIds: realestateHandlers,
  specSource: `REALESTATE_TOOL_SPECS (${LANGGRAPH_REGISTRY})`,
  handlerSource: `REALESTATE_TOOL_HANDLERS (${REALESTATE_TOOLS})`,
})

// ── 4. L'assertion historique : tout runnable doit être buildable ────────────
const runnable = [...new Set([...nativeNames, ...marketHandlers, ...realestateHandlers])]
const missing = runnable.filter((name) => !langgraphBuildable.has(name))

if (missing.length > 0) {
  fail([
    `\n✗ ${missing.length} outil(s) runnable sur le chemin direct mais NON buildable par le registre LangGraph :\n`,
    ...missing.map((name) => `  ${name}`),
    '\n  Un agent qui en déclare un ne monte rien et répond « pas de données »',
    '  avec tool_call_count = 0 pendant que le catalogue le déclare sain.',
    `  Fix : enregistre-le dans ${LANGGRAPH_REGISTRY}, ou supprime le handler.`,
  ])
}

if (failed) {
  console.error('\nRegistry-parity guard FAILED.\n')
  process.exit(1)
}

console.log('✓ Registry-parity guard passed — every directly-runnable tool is buildable by the LangGraph graph.')
console.log(`  ${langgraphBuildable.size} id(s) buildable ; ${runnable.length} runnable vérifié(s)`)
console.log(`  (${nativeNames.length} natifs + ${marketHandlers.length} market + ${realestateHandlers.length} realestate), parité bidirectionnelle sur 2 familles.`)
