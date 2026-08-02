#!/usr/bin/env node
/**
 * Dev-port guard — the rule in AGENTS.md § "Port de dev", made executable.
 *
 * WHY THIS EXISTS. The port was "reserved" by a sentence in a markdown file for
 * months, and on 2026-07-30 `hearst-connect-v1-green-lab` took 3210 anyway and
 * squatted Aigent's dev server. A sentence does not reserve a port and does not
 * stop the next agent from re-hardcoding a banned one: only a gate does. So the
 * move to 3987 ships with the check that keeps it.
 *
 * Two failures, both about pointing this repo at a server that is not ours:
 *
 *  1. A BANNED port (3000, 3001, 3210) appears in live code or doctrine. Those
 *     belong to other Next projects on this machine. Binding one overwrites a
 *     neighbour; READING one is just as bad — a probe that answers is somebody
 *     else's app, and reporting its output as Aigent's is a false diagnosis.
 *  2. A port literal that is neither the canonical 3987 nor an explicit
 *     `AIGENT_DEV_PORT` fallback drifts into the resolver files, so the stack,
 *     the health probe and the live suite cannot silently disagree.
 *
 * Prohibition prose is allowed to name the banned ports — a rule has to be able
 * to say what it forbids — so lines that ban rather than use are exempt.
 * Historical mission captures lived under `docs/visual-reviews/` (removed —
 * git history only). Fixture snapshots under `tests/fixtures/` are exempt.
 *
 * Pure Node, no deps. Run via `npm run check:dev-port`.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const CANONICAL = 3987
const BANNED = [3000, 3001, 3210]

/** Files that must resolve the dev port identically. */
const RESOLVERS = [
  'scripts/dev-stack.mjs',
  'scripts/health.mjs',
  'tests/live/helpers.ts',
  'src/langgraph/tool-registry.mjs',
]

const SCAN_DIRS = ['src', 'scripts', 'tests', 'docs', '.claude']
const SCAN_ROOT_FILES = ['README.md', 'AGENTS.md', 'CLAUDE.md']
const SCAN_EXT = /\.(ts|tsx|mjs|js|md|json)$/

/**
 * Records of the past, not instructions for the present. These describe work
 * done when the port really was 3210.
 */
const EXEMPT = [
  'tests/fixtures/',
  'node_modules/',
  '.next/',
  // This gate's own prose names the banned ports to forbid them.
  'scripts/check-dev-port.mjs',
]

/**
 * Ports on OTHER hosts are other services, not our dev server. Langfuse lives on
 * `192.168.1.74:3001` and unit fixtures use unroutable addresses like
 * `10.0.0.1:3000` precisely because nothing answers there. Only a loopback or
 * bare-`:port` reference can mean "the Aigent dev server".
 */
const FOREIGN_HOST = /\b(?!127\.0\.0\.1|localhost)(?:\d{1,3}\.){3}\d{1,3}:/

/** `3000-3400` describes the crowded band; it is not a port being used. */
const PORT_RANGE = /\d{4}\s*-\s*\d{4}/

/** A line that FORBIDS a port rather than using it. */
const PROHIBITION = /jamais|never|banned|interdit|forbidden|used to be|removed because|squatt|ne l'est|belongs? to other|pointed the suite/i

/** Port-shaped literal: a colon or bare 4-digit in a URL/port position. */
const PORT_HIT = (port) => new RegExp(`(?::|\\b)${port}\\b`)

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    if (entry.isDirectory()) yield* walk(full)
    else if (SCAN_EXT.test(entry.name)) yield full
  }
}

const failures = []

async function scan(file) {
  const rel = relative(ROOT, file)
  if (EXEMPT.some((prefix) => rel.startsWith(prefix))) return

  const text = await readFile(file, 'utf8')
  const lines = text.split('\n')

  lines.forEach((line, index) => {
    if (PROHIBITION.test(line)) return
    if (FOREIGN_HOST.test(line)) return
    if (PORT_RANGE.test(line)) return
    for (const port of BANNED) {
      if (!PORT_HIT(port).test(line)) continue
      // A bare number inside unrelated data (prices, ids, hashes) is not a port.
      if (!/(localhost|127\.0\.0\.1|:\/\/|PORT|port|:\d{4})/i.test(line)) continue
      failures.push(`${rel}:${index + 1} — banned dev port ${port}: ${line.trim().slice(0, 110)}`)
    }
  })
}

for (const name of SCAN_ROOT_FILES) await scan(join(ROOT, name))
for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(ROOT, dir))) await scan(file)
}

// Every resolver must agree on the canonical port.
for (const rel of RESOLVERS) {
  let text
  try {
    text = await readFile(join(ROOT, rel), 'utf8')
  } catch {
    failures.push(`${rel} — resolver file missing; the dev port can no longer be verified`)
    continue
  }
  // The FALLBACK EXPRESSION, not merely the digits: a comment mentioning 3987
  // while the code resolves to something else is exactly the silent drift this
  // check exists to catch.
  const fallbacks = [...text.matchAll(/AIGENT_DEV_PORT\)?\s*\|\|\s*(\d{2,5})/g)].map((m) => Number(m[1]))
  if (fallbacks.length === 0) {
    failures.push(`${rel} — no \`AIGENT_DEV_PORT || <port>\` fallback found; the dev port is unpinned here`)
    continue
  }
  for (const port of fallbacks) {
    if (port !== CANONICAL) {
      failures.push(`${rel} — resolves the dev port to ${port}, not the canonical ${CANONICAL}`)
    }
  }
}

// npm scripts that start Next must pin 3987 or AIGENT_DEV_PORT — never bare `next dev`.
{
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
  } catch {
    failures.push('package.json — unreadable; dev scripts cannot be verified')
    pkg = null
  }
  if (pkg?.scripts) {
    for (const [name, command] of Object.entries(pkg.scripts)) {
      if (typeof command !== 'string') continue
      if (!/\bnext\s+dev\b/.test(command)) continue
      const pinsPort =
        /--port\s+\$\{AIGENT_DEV_PORT:-3987\}/.test(command) ||
        /--port\s+3987\b/.test(command) ||
        /AIGENT_DEV_PORT/.test(command)
      if (!pinsPort) {
        failures.push(
          `package.json scripts.${name} — starts Next without pinning port ${CANONICAL} or AIGENT_DEV_PORT: ${command}`
        )
      }
      if (/\bnext\s+dev\s*$/.test(command.trim())) {
        failures.push(
          `package.json scripts.${name} — bare \`next dev\` would default to port 3000: ${command}`
        )
      }
    }
    if (pkg.scripts['dev:legacy']) {
      failures.push('package.json scripts.dev:legacy — unsupervised dev entry must be removed; use npm run dev')
    }
  }
}

if (failures.length > 0) {
  console.error(`✗ check:dev-port — ${failures.length} violation(s).\n`)
  for (const failure of failures) console.error(`  ${failure}`)
  console.error(
    `\n  The dev port is ${CANONICAL} (AGENTS.md § "Port de dev"). Ports ${BANNED.join('/')} belong to`
  )
  console.error('  other Next projects on this machine — never bind them, never probe them.')
  process.exit(1)
}

console.log(
  `✓ check:dev-port — dev port pinned to ${CANONICAL} in ${RESOLVERS.length} resolver(s); no banned port (${BANNED.join('/')}) in live code or doctrine.`
)
