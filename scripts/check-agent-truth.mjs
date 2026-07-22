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
 * Exit 0 = clean, exit 1 = violation. Read-only, no network, no secret.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src')

/** Paths whose contents are served to users at request time. */
const RUNTIME_DIRS = ['app', 'components']

const ROSTER_IMPORT_RE =
  /from\s+['"][^'"]*(?:market|dropship)\/agents\/roster['"]/
const DELIVERY_READ_RE = /['"][^'"]*delivery\/tradeagent[^'"]*['"]/

/**
 * A quoted provider/model literal in the canonical contract. `WIRED_PROVIDERS`
 * legitimately lists provider NAMES to validate against — that is a whitelist,
 * not a default — so only assignment-shaped defaults are flagged.
 */
const FABRICATED_DEFAULT_RE =
  /(?:provider|configuredModel|executedModel|model)\s*(?:=|:)\s*['"](?:openai|google|mistral|local|gpt-[\w.-]+|claude-[\w.-]+|gemini-[\w.-]+)['"]/

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

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    const text = await readFile(file, 'utf8')
    const isRuntime = RUNTIME_DIRS.some((d) => rel.startsWith(d + '/'))

    if (isRuntime) {
      text.split('\n').forEach((line, i) => {
        if (ROSTER_IMPORT_RE.test(line)) rosterInApp.push(`${relative(ROOT, file)}:${i + 1}`)
        if (DELIVERY_READ_RE.test(line)) deliveryInApp.push(`${relative(ROOT, file)}:${i + 1}`)
      })
    }

    if (rel === 'lib/agent-mission-control/available-agents.ts') {
      text.split('\n').forEach((line, i) => {
        if (line.trimStart().startsWith('*') || line.trimStart().startsWith('//')) return
        if (FABRICATED_DEFAULT_RE.test(line)) fabricatedDefaults.push(`${relative(ROOT, file)}:${i + 1}  ${line.trim()}`)
      })
    }
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
  console.log('✓ Runtime-truth guard passed — no roster, no static package and no fabricated default in the runtime paths.')
}

await main()
