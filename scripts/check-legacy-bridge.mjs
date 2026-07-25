#!/usr/bin/env node
/**
 * Legacy bridge guard — fails CI if a file outside the committed allowlists
 * still imports the legacy surface-card.tsx bridge or still introduces a
 * new legacy `--color-surface-*` token usage.
 *
 * Context: `agent-ops/surface-card.tsx` is the formal legacy bridge (it
 * re-exports the deprecated `_legacy/surface-legacy.ts` aliases so ~73
 * existing importers don't break in one commit). Tracing only direct
 * imports of `agent-ops/_legacy/*` measures nothing real — nobody imports
 * `_legacy/*` directly, everybody imports `surface-card.tsx`. This gate
 * therefore traces importers of `surface-card.tsx` itself, exactly like
 * `check-catalyst.mjs` already does by knowing that file in hardcoded
 * (`isSurfaceSource`).
 *
 * Two allowlists, both committed, both monotonically decreasing (a file
 * only ever leaves a list when it's migrated — never gains a new entry):
 *   - scripts/legacy-bridge-allowlist.json         — current importers of
 *     `@/components/agent-ops/surface-card` (or `agent-ops/_legacy/*`).
 *   - scripts/legacy-color-surface-allowlist.json  — current consumers of
 *     `var(--color-surface-canvas|primary|secondary|interactive|elevated|
 *     focus|foreground)`.
 *
 * Pure Node, no deps. Run via `npm run check:legacy-bridge`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const BRIDGE_ALLOWLIST_PATH = join(ROOT, 'scripts', 'legacy-bridge-allowlist.json')
const COLOR_ALLOWLIST_PATH = join(ROOT, 'scripts', 'legacy-color-surface-allowlist.json')

const LEGACY_BRIDGE_IMPORT_RE = /from\s+['"](@\/components\/agent-ops\/surface-card|.*agent-ops\/_legacy\/[^'"]*)['"]/
const LEGACY_COLOR_TOKEN_RE = /var\(--color-surface-(?:canvas|primary|secondary|interactive|elevated|focus|foreground)\)/

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full
    }
  }
}

function lineIsComment(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.includes('{/*')
}

async function loadAllowlist(path) {
  const raw = await readFile(path, 'utf8')
  const list = JSON.parse(raw)
  return new Set(list)
}

async function main() {
  const bridgeAllowlist = await loadAllowlist(BRIDGE_ALLOWLIST_PATH)
  const colorAllowlist = await loadAllowlist(COLOR_ALLOWLIST_PATH)

  const bridgeViolations = []
  const colorViolations = []

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    // surface-card.tsx itself is the bridge, not an importer of itself.
    const isBridgeSource = rel === join('components', 'agent-ops', 'surface-card.tsx')
    // theme.css consumers are tracked via the color allowlist even though
    // walk() only yields .ts/.tsx — theme.css is a non-code file and is
    // pre-seeded in the allowlist for when it's touched, not scanned here.

    const text = await readFile(file, 'utf8')
    const lines = text.split('\n')

    lines.forEach((line, i) => {
      if (lineIsComment(line)) return

      if (!isBridgeSource && !bridgeAllowlist.has(rel) && LEGACY_BRIDGE_IMPORT_RE.test(line)) {
        bridgeViolations.push(
          `${relative(ROOT, file)}:${i + 1}  imports the legacy surface-card.tsx bridge (or _legacy/* directly) but is not in scripts/legacy-bridge-allowlist.json`
        )
      }

      if (!colorAllowlist.has(rel) && LEGACY_COLOR_TOKEN_RE.test(line)) {
        colorViolations.push(
          `${relative(ROOT, file)}:${i + 1}  uses a legacy var(--color-surface-...) token but is not in scripts/legacy-color-surface-allowlist.json`
        )
      }
    })
  }

  let failed = false
  if (bridgeViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${bridgeViolations.length} new legacy bridge import(s) outside the allowlist:\n`)
    for (const v of bridgeViolations) console.error('  ' + v)
  }
  if (colorViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${colorViolations.length} new legacy --color-surface-* usage(s) outside the allowlist:\n`)
    for (const v of colorViolations) console.error('  ' + v)
  }

  if (failed) {
    console.error(
      '\nLegacy bridge guard FAILED.\n' +
        'These two allowlists (scripts/legacy-bridge-allowlist.json, scripts/legacy-color-surface-allowlist.json) ' +
        'may only shrink: edit them to REMOVE a file once it is migrated to ui/Panel/Section and the canonical ' +
        'theme.css ladder — never to ADD a new file. A failure here means either (a) a file not on the list started ' +
        'importing the legacy bridge / using a legacy token, which is a regression, or (b) you migrated a file and ' +
        'forgot to remove it from the allowlist in the same commit.\n'
    )
    process.exit(1)
  }
  console.log('✓ Legacy bridge guard passed — no new surface-card.tsx importers, no new legacy --color-surface-* usage.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
