#!/usr/bin/env node
/**
 * Demolition guard (P006) — fails if the surviving front reaches back into a
 * visual layer this mission deleted.
 *
 * The demolition removed `components/agent-ops/**`, `components/views/**`,
 * `components/shell/**`, the P004 rebuild namespaces, the maison wrappers
 * (`ui/panel`, `ui/section`) and the old shell primitives (`ui/sidebar`,
 * `ui/sidebar-layout`, `ui/navbar`), plus every `/admin-v2` route. Nothing
 * stops a later commit from re-creating one of those paths and importing it
 * again — except this gate.
 *
 * Three checks, all on facts a grep or a stat can prove:
 *   1. NO IMPORT of a deleted layer, anywhere under `src/`.
 *   2. NO `/admin-v2` route or reference, anywhere under `src/`.
 *   3. NO still-deleted admin ROUTE FILE back on disk. Project Builder is the
 *      first explicitly commissioned post-demolition screen and is allowed.
 *
 * ANTI-BLINDNESS: a guard anchored on paths that no longer exist can pass by
 * scanning nothing. The scan root is therefore verified before the verdict, and
 * an empty scan fails instead of printing a green tick.
 *
 * Pure Node, no deps. Run via `npm run check:no-legacy-front`.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/** Every visual layer P006 deleted. Re-importing one is the regression. */
const DELETED_LAYERS = [
  '@/components/agent-ops',
  '@/components/views',
  '@/components/shell',
  '@/components/admin-dashboard',
  '@/components/admin-shell',
  '@/components/runs-console',
  '@/components/aigent-v2',
  '@/components/ui/panel',
  '@/components/ui/section',
  '@/components/ui/sidebar',
  '@/components/ui/sidebar-layout',
  '@/components/ui/navbar',
]

/** The route family the mission forbids outright. */
const FORBIDDEN_ROUTE = '/admin-v2'

/**
 * Every admin route P006 demolished, as a path relative to `src/app/admin`.
 * Project Builder is deliberately absent from this list: it is a new screen,
 * built from current primitives and the surviving server contracts.
 */
const DELETED_ADMIN_ROUTES = [
  'factory',
  'performance',
  'settings',
  'telemetry',
  'not-found.tsx',
]

// `src/app/admin/error.tsx` is the one commissioned exception: a top-level
// error boundary for the whole `/admin` segment, built from current Catalyst
// primitives, not a resurrection of the deleted dashboard's error handling.
// Anything else named `error.tsx` deeper in the tree (a route re-creating its
// own legacy boundary) is still forbidden — only this exact path is allowed.
const ALLOWED_ERROR_BOUNDARY = join(SRC, 'app', 'admin', 'error.tsx')

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
  const t = line.trim()
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.includes('{/*')
}

async function main() {
  try {
    await stat(SRC)
  } catch {
    console.error(`\n✗ ${relative(ROOT, SRC)} does not exist — this guard would scan nothing.\n`)
    process.exit(1)
  }

  const violations = []
  let scanned = 0

  for await (const file of walk(SRC)) {
    scanned += 1
    const rel = relative(ROOT, file)
    const text = await readFile(file, 'utf8')

    text.split('\n').forEach((line, i) => {
      if (lineIsComment(line)) return

      for (const layer of DELETED_LAYERS) {
        if (line.includes(`'${layer}`) || line.includes(`"${layer}`)) {
          violations.push(`${rel}:${i + 1}  imports ${layer} — that layer was deleted by P006`)
        }
      }

      if (line.includes(FORBIDDEN_ROUTE)) {
        violations.push(`${rel}:${i + 1}  references ${FORBIDDEN_ROUTE} — that route must not exist`)
      }
    })
  }

  if (scanned === 0) {
    console.error('\n✗ scanned 0 files under src/ — the guard is not anchored on anything.\n')
    process.exit(1)
  }

  const ADMIN_DIR = join(SRC, 'app', 'admin')
  for (const entry of DELETED_ADMIN_ROUTES) {
    try {
      await stat(join(ADMIN_DIR, entry))
      violations.push(`src/app/admin/${entry}  route re-created — that screen was deleted by P006`)
    } catch {
      // Absent, as required.
    }
  }

  // Any `error.tsx` under `src/app/admin/**` other than the one commissioned
  // top-level boundary is a legacy resurrection — a route re-growing its own
  // error handling is exactly the per-screen sprawl P006 removed.
  for await (const file of walk(ADMIN_DIR)) {
    if (file.endsWith('error.tsx') && file !== ALLOWED_ERROR_BOUNDARY) {
      violations.push(`${relative(ROOT, file)}  error boundary re-created outside the allowed path`)
    }
  }

  if (violations.length > 0) {
    console.error(`\n✗ ${violations.length} reference(s) to a demolished front:\n`)
    for (const v of violations) console.error('  ' + v)
    console.error(
      '\nDemolition guard FAILED.\n' +
        'The old visual layers were deleted on purpose. Build what you need from the Catalyst ' +
        'primitives in src/components/ui/ — do not resurrect a deleted path, and do not create ' +
        '/admin-v2.\n'
    )
    process.exit(1)
  }

  console.log(
    `✓ Demolition guard passed — ${scanned} file(s) scanned, no deleted visual layer imported, ` +
      `no ${FORBIDDEN_ROUTE}, no demolished admin route re-created.`
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
