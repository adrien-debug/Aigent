#!/usr/bin/env node
/**
 * Frontend V2 boundary guard — keeps the V2 slice INSIDE the design system.
 *
 * P003 reversed the original rule. The first version of this gate forbade V2
 * from importing Catalyst; the doctrine now requires the opposite — Catalyst is
 * mandatory and no parallel design system may exist. This file enforces that
 * new direction, and is deliberately NOT deleted: the perimeter still needs a
 * gate, only the rule changed.
 *
 * Three checks, each on a concrete, greppable fact:
 *
 *  1. NO PARALLEL TOKEN MODULE. A `tokens|theme|palette|design-system` module
 *     inside the V2 perimeter is how a second design system starts. The kit
 *     already owns those roles (`src/theme.css`, `components/ui/panel.tsx`).
 *
 *  2. NO RAW COLOUR LITERAL. A `#rrggbb` / `rgb()` / `oklch()` in V2 markup is a
 *     colour chosen outside the palette. Colour comes from the accent/zinc
 *     scales or a `--state-*` role, never from a hex typed into a className.
 *
 *  3. V2 ACTUALLY USES THE KIT. At least one `@/components/ui/*` import must
 *     exist in the perimeter. Without this the gate would pass on a V2 that
 *     rebuilt everything from bare divs — the exact outcome P003 forbids.
 *
 * ANTI-BLINDNESS: the perimeter and the kit are hardcoded paths. Rename either
 * and a naive walk would scan nothing and still print ✓, so both anchors are
 * verified BEFORE the verdict and a missing one fails the gate.
 *
 * Pure Node, no deps. Run via `npm run check:frontend-v2-boundary`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const V2_DIRS = [
  join(SRC, 'app', 'admin-v2'),
  join(SRC, 'components', 'aigent-v2'),
  join(SRC, 'lib', 'aigent-v2'),
]

/** The kit V2 must consume. If this moves, check 3 stops meaning anything. */
const KIT_DIR = join(SRC, 'components', 'ui')

const PARALLEL_DS_FILE_RE = /(^|\/)(tokens|theme|palette|design-system)\.(ts|tsx|css)$/
const RAW_COLOUR_RE = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\boklch\(/
const KIT_IMPORT_RE = /from\s+['"]@\/components\/ui\//

/**
 * Colour literals that are NOT a parallel palette: a `--state-*` / `--surface-*`
 * / `--color-*` role read out of the theme, and SVG geometry referencing the
 * kit's own custom properties.
 */
const ALLOWED_COLOUR_LINE_RE = /var\(--(?:state|surface|color|accent|chart|btn)-/

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(ts|tsx|js|jsx|mjs|cjs|css)$/.test(entry.name)) yield full
  }
}

function lineIsComment(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.includes('{/*')
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function main() {
  const violations = []
  const anchorErrors = []
  let scanned = 0
  let kitImports = 0

  for (const dir of V2_DIRS) {
    if (!(await exists(dir))) {
      anchorErrors.push(
        `V2 perimeter ${relative(ROOT, dir)} does not exist — the guard would scan nothing and pass`
      )
      continue
    }

    for await (const file of walk(dir)) {
      scanned += 1
      const rel = relative(ROOT, file)

      if (PARALLEL_DS_FILE_RE.test(rel)) {
        violations.push(
          `${rel}  is a parallel design-system module — tokens live in src/theme.css and src/components/ui/, not in the V2 slice`
        )
      }

      const text = await readFile(file, 'utf8')
      if (KIT_IMPORT_RE.test(text)) kitImports += 1

      text.split('\n').forEach((line, i) => {
        if (lineIsComment(line)) return
        if (ALLOWED_COLOUR_LINE_RE.test(line)) return
        if (RAW_COLOUR_RE.test(line)) {
          violations.push(
            `${rel}:${i + 1}  raw colour literal — use the accent/zinc scales or a --state-* role, never a hex typed inline`
          )
        }
      })
    }
  }

  if (!(await exists(KIT_DIR))) {
    anchorErrors.push(
      `the Catalyst kit ${relative(ROOT, KIT_DIR)} does not exist — check 3 would pass vacuously`
    )
  }

  if (scanned === 0 && anchorErrors.length === 0) {
    anchorErrors.push('the V2 perimeter exists but holds no source file — nothing was actually checked')
  }

  if (anchorErrors.length > 0) {
    console.error('\n✗ Frontend V2 boundary guard is not anchored:\n')
    for (const e of anchorErrors) console.error('  ' + e)
    console.error(
      '\nFix the paths in scripts/check-frontend-v2-boundary.mjs (V2_DIRS / KIT_DIR) so the gate ' +
        'keeps checking something real.\n'
    )
    process.exit(1)
  }

  if (kitImports === 0) {
    violations.push(
      'no file in the V2 perimeter imports @/components/ui/* — V2 must be BUILT on Catalyst, not beside it (P003)'
    )
  }

  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} parallel-design-system violation(s) in frontend V2:\n`)
    for (const v of violations) console.error('  ' + v)
    console.error(
      '\nFrontend V2 boundary guard FAILED.\n' +
        'src/app/admin-v2/**, src/components/aigent-v2/** and src/lib/aigent-v2/** must use the ' +
        'Catalyst primitives in src/components/ui/ and the tokens in src/theme.css. No second ' +
        'palette, no local token module, no hex typed into a className.\n'
    )
    process.exit(1)
  }

  console.log(
    `✓ Frontend V2 boundary guard passed — ${scanned} V2 file(s) scanned, ${kitImports} on Catalyst, no parallel design system.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
