#!/usr/bin/env node
/**
 * Runtime-truth guard — keeps fake agents OUT of the paths users actually hit.
 *
 * The point is not to clean the repo once; it is to make the regression
 * impossible to land silently. Rosters, fixtures and delivery packages are
 * legitimate artefacts (config, seeding, export) — they simply must never
 * become the catalogue the app serves.
 *
 * Three checks, each on a concrete import/read, never on a vague keyword:
 *
 *  1. NO ROSTER IN THE APP. `market/agents/roster.ts` and
 *     `dropship/agents/roster.ts` are pure config describing agents that may
 *     never have been provisioned. Importing one from `src/app` or
 *     `src/components` would publish a catalogue nobody can execute.
 *
 *  2. NO STATIC PACKAGE READ IN THE APP. `delivery/tradeagent/**` holds frozen,
 *     checksummed export packages. Reading them at request time would serve a
 *     snapshot as if it were the live registry.
 *
 *  3. NO FABRICATED DEFAULT IN THE CANONICAL CONTRACT. `available-agents.ts`
 *     must not hard-code a provider or model name: an unresolved provider is
 *     `null` + `unavailableFields`, never `'openai'`; an unresolved model is
 *     `null`, never `'gpt-…'`.
 *
 * ANTI-CÉCITÉ (sonde du 26/07/2026). Les trois checks sont ancrés sur des
 * CHEMINS EN DUR. Un renommage les efface sans un mot — mesuré : en renommant
 * `available-agents.ts`, le check 3 disparaissait et la gate sortait quand même
 * 0 avec son ✓ habituel. Idem si `src/app`/`src/components` bougeaient : `walk`
 * avalait l'ENOENT et la gate déclarait « aucun roster dans le runtime » sans
 * avoir ouvert un seul fichier. Les ancrages sont donc VÉRIFIÉS avant le verdict :
 * si une cible protégée a disparu, la gate échoue au lieu de garder un fantôme.
 *
 * Exit 0 = clean, exit 1 = violation. Read-only, no network, no secret.
 */
import { readFile, readdir, access } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** Paths whose contents are served to users at request time. */
const RUNTIME_DIRS = ['app', 'components']

/** The canonical agent contract — check 3 is meaningless if it moves. */
const CONTRACT_REL = 'lib/agent-mission-control/available-agents.ts'

/**
 * Les cibles que les regex prétendent garder. Si l'une disparaît, la règle
 * correspondante ne protège plus rien : mieux vaut le dire que rester verte
 * sur un chemin que plus personne ne peut importer.
 */
const GUARDED_TARGETS = [
  join(SRC, 'lib/agent-mission-control/market/agents/roster.ts'),
  join(SRC, 'lib/agent-mission-control/dropship/agents/roster.ts'),
  join(ROOT, 'delivery/tradeagent'),
  join(SRC, CONTRACT_REL),
]

const ROSTER_IMPORT_RE =
  /from\s+['"][^'"]*(?:market|dropship)\/agents\/roster['"]/
const DELIVERY_READ_RE = /['"][^'"]*delivery\/tradeagent[^'"]*['"]/

/**
 * A quoted provider/model literal in the canonical contract. `WIRED_PROVIDERS`
 * legitimately lists provider NAMES to validate against — that is a whitelist,
 * not a default — so only assignment-shaped defaults are flagged.
 */
const FABRICATED_LITERAL = '(?:openai|google|mistral|local|gpt-[\\w.-]+|claude-[\\w.-]+|gemini-[\\w.-]+)'
const FABRICATED_DEFAULT_RE = new RegExp(
  `(?:provider|configuredModel|executedModel|model)\\s*(?:=|:)\\s*['"]${FABRICATED_LITERAL}['"]`
)
/**
 * Second shape, ajoutée après sonde : l'assignation directe était la seule
 * forme couverte, donc `provider ?? 'openai'` — le fabricant de défaut le plus
 * NATUREL en TypeScript — passait sous le radar (mesuré : injecté, gate verte).
 * Un provider non résolu doit rester `null` + `unavailableFields`, jamais
 * retomber sur un nom inventé par un `??`/`||`.
 */
const FABRICATED_FALLBACK_RE = new RegExp(
  `(?:provider|model)\\w*\\s*(?:\\?\\?|\\|\\|)\\s*['"]${FABRICATED_LITERAL}['"]`,
  'i'
)

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      yield* walk(full)
    } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
      yield full
    }
  }
}

async function main() {
  const rosterInApp = []
  const deliveryInApp = []
  const fabricatedDefaults = []
  // Compteurs d'aveuglement : ce que la gate a RÉELLEMENT ouvert.
  let runtimeFilesScanned = 0
  let contractSeen = false

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    const text = await readFile(file, 'utf8')
    const isRuntime = RUNTIME_DIRS.some((d) => rel.startsWith(d + '/'))

    if (isRuntime) {
      runtimeFilesScanned += 1
      text.split('\n').forEach((line, i) => {
        if (ROSTER_IMPORT_RE.test(line)) rosterInApp.push(`${relative(ROOT, file)}:${i + 1}`)
        if (DELIVERY_READ_RE.test(line)) deliveryInApp.push(`${relative(ROOT, file)}:${i + 1}`)
      })
    }

    if (rel === CONTRACT_REL) {
      contractSeen = true
      text.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return
        if (FABRICATED_DEFAULT_RE.test(line) || FABRICATED_FALLBACK_RE.test(line)) {
          fabricatedDefaults.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`)
        }
      })
    }
  }

  // ── Garde-fou anti-cécité, AVANT tout verdict ─────────────────────────────
  // Chacun de ces cas produisait auparavant un ✓ trompeur.
  const blind = []
  if (runtimeFilesScanned === 0) {
    blind.push(`0 fichier runtime scanné dans src/{${RUNTIME_DIRS.join(',')}} — les checks 1 et 2 n'ont rien lu`)
  }
  if (!contractSeen) {
    blind.push(`le contrat canonique src/${CONTRACT_REL} n'a pas été rencontré — le check 3 n'a rien inspecté`)
  }
  for (const target of GUARDED_TARGETS) {
    try {
      await access(target)
    } catch {
      blind.push(`cible protégée absente : ${relative(ROOT, target)} — la règle qui la vise ne garde plus rien`)
    }
  }
  if (blind.length > 0) {
    console.error('\n✗ Runtime-truth guard AVEUGLE — il ne mesure pas ce qu\'il prétend garder :\n')
    for (const b of blind) console.error('  ' + b)
    console.error('\n  Une gate qui indexe 0 élément doit ÉCHOUER, jamais passer en silence.')
    console.error('  → mets à jour RUNTIME_DIRS / CONTRACT_REL / GUARDED_TARGETS après un renommage.\n')
    process.exit(1)
  }

  let failed = false
  const report = (items, title) => {
    if (items.length === 0) return
    failed = true
    console.error(`\n✗ ${items.length} ${title}:\n`)
    for (const item of items) console.error('  ' + item)
  }

  report(rosterInApp, 'agent roster(s) imported by a runtime path (config ≠ provisioned copilot)')
  report(deliveryInApp, 'static delivery package(s) read by a runtime path (snapshot ≠ live registry)')
  report(fabricatedDefaults, 'fabricated provider/model default(s) in the canonical agent contract')

  if (failed) {
    console.error('\nRuntime-truth guard FAILED.\n')
    process.exit(1)
  }
  // Le volume mesuré est imprimé exprès : il prouve que la gate a REGARDÉ.
  console.log('✓ Runtime-truth guard passed — no roster, no static package and no fabricated default in the runtime paths.')
  console.log(`  ${runtimeFilesScanned} fichier(s) runtime scanné(s), contrat canonique inspecté, ${GUARDED_TARGETS.length} cible(s) protégée(s) présente(s).`)
}

await main()
