#!/usr/bin/env node
/**
 * Views migration guard — enforces the per-route "done" criteria for the
 * catalyst-in-layers migration (see the migration plan for full context).
 *
 * For every `page.tsx` under `src/app/admin/**`:
 *
 *   - If it imports from `@/components/views/*` (i.e. it has been migrated):
 *       1) its component body must be <= 20 lines (blank trailing line
 *          excluded; `generateMetadata` is a separate function and is
 *          exempted — heavy data-fetching belongs in a dedicated
 *          `lib/agent-mission-control/<route>-page-data.ts` helper, not
 *          inline in page.tsx).
 *       2) it must contain no legacy `var(--color-surface-...)` class and no
 *          direct import of `agent-ops/_legacy/*`.
 *       3) it must NOT appear in scripts/not-yet-migrated.json (that list is
 *          for routes not yet migrated — being both migrated and listed
 *          means the list wasn't updated).
 *
 *   - If it does NOT import from `@/components/views/*` (not yet migrated):
 *       it MUST appear in scripts/not-yet-migrated.json — a page.tsx that
 *       is neither migrated nor tracked as pending is a half-done migration.
 *
 * Additionally, every view file under `src/components/views/**` must import
 * at least one of Panel / Section / PageLayout (simple grep, no AST) — a
 * "view" that doesn't use the new layout primitives isn't actually using
 * the new architecture.
 *
 * NOT INSPECTED — the non-`page.tsx` files under src/app/admin/**. Only route
 * entry points carry the migration criteria: `not-yet-migrated.json` is keyed
 * by route, and the 20-line budget is about a page delegating to a view, which
 * says nothing about a layout or a spinner. The exempt kinds are:
 *
 *   - `layout.tsx`   — shell wiring (SidebarLayout), no page-level render logic
 *   - `loading.tsx`  — Suspense fallback, a skeleton
 *   - `error.tsx`    — error boundary, a client component with its own contract
 *   - `not-found.tsx`— 404 boundary
 *
 * They are NOT unguarded: `check:catalyst`, `check:ds`, `check:danger` and
 * `check:render-truth` all scan src/app/admin/** whole, files included. The
 * exact list of files skipped here is printed on every green run, so this
 * comment cannot quietly stop describing reality.
 *
 * Pure Node, no deps. Run via `npm run check:views`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const ADMIN_DIR = join(SRC, 'app', 'admin')
const VIEWS_DIR = join(SRC, 'components', 'views')
const NOT_YET_MIGRATED_PATH = join(ROOT, 'scripts', 'not-yet-migrated.json')

const VIEWS_IMPORT_RE = /from\s+['"]@\/components\/views\//
const LEGACY_COLOR_TOKEN_RE = /var\(--color-surface-(?:canvas|primary|secondary|interactive|elevated|foreground|focus)\)/
const LEGACY_IMPORT_RE = /from\s+['"].*agent-ops\/_legacy\/[^'"]*['"]/
const LAYOUT_PRIMITIVE_IMPORT_RE = /import\s*\{[^}]*\b(Panel|Section|PageLayout)\b[^}]*\}\s*from/

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    if (err.code === 'ENOENT') return
    throw err
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      yield full
    }
  }
}

function stripGenerateMetadata(text) {
  // Remove a top-level `export async function generateMetadata(...) { ... }`
  // (or non-async / arrow variants) so its lines don't count toward the
  // page component's own line budget. Best-effort brace matching — good
  // enough for this repo's simple metadata functions.
  const fnStart = text.search(/export\s+(async\s+)?function\s+generateMetadata\s*\(/)
  if (fnStart === -1) return text
  // The body's opening brace is NOT simply the first `{` after fnStart — a
  // destructured param (`{ params }: { params: ... }`) puts `{` characters
  // in the signature before the body ever starts. Walk past the balanced
  // parameter-list parens first (params can themselves contain `{}` for
  // destructuring/typed object literals), then take the first `{` after
  // that closing paren — which is always the body, since a `: ReturnType`
  // annotation between `)` and `{` never itself opens a brace for a plain
  // `Promise<Metadata>`-style return type.
  const parenOpen = text.indexOf('(', fnStart)
  if (parenOpen === -1) return text
  let parenDepth = 0
  let parenClose = -1
  for (let i = parenOpen; i < text.length; i++) {
    if (text[i] === '(') parenDepth++
    else if (text[i] === ')') {
      parenDepth--
      if (parenDepth === 0) {
        parenClose = i
        break
      }
    }
  }
  if (parenClose === -1) return text
  const braceOpen = text.indexOf('{', parenClose)
  if (braceOpen === -1) return text
  let depth = 0
  let i = braceOpen
  for (; i < text.length; i++) {
    if (text[i] === '{') depth++
    else if (text[i] === '}') {
      depth--
      if (depth === 0) {
        i++
        break
      }
    }
  }
  return text.slice(0, fnStart) + text.slice(i)
}

function countBodyLines(text) {
  const withoutMetadata = stripGenerateMetadata(text)
  const lines = withoutMetadata.split('\n')
  // Drop a single trailing blank line (final newline of the file), and any
  // further trailing blank lines left behind by removing generateMetadata.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  return lines.length
}

async function loadNotYetMigrated() {
  const raw = await readFile(NOT_YET_MIGRATED_PATH, 'utf8')
  const list = JSON.parse(raw)
  return new Set(list)
}

async function main() {
  const notYetMigrated = await loadNotYetMigrated()

  const lineCountViolations = []
  const legacyTokenViolations = []
  const legacyImportViolations = []
  const shouldBeRemovedFromList = []
  const missingFromList = []

  const inspectedPages = []
  const exemptNonPageFiles = []

  for await (const file of walk(ADMIN_DIR)) {
    if (relative(SRC, file).split('/').pop() !== 'page.tsx') {
      exemptNonPageFiles.push(relative(ROOT, file))
      continue
    }

    inspectedPages.push(relative(ROOT, file))
    const relFromApp = relative(join(SRC, 'app'), file)
    const text = await readFile(file, 'utf8')
    const isMigrated = VIEWS_IMPORT_RE.test(text)

    if (isMigrated) {
      const bodyLines = countBodyLines(text)
      if (bodyLines > 20) {
        lineCountViolations.push(
          `${relative(ROOT, file)}  ${bodyLines} lines (max 20) — extract data-fetching into lib/agent-mission-control/<route>-page-data.ts`
        )
      }
      if (LEGACY_COLOR_TOKEN_RE.test(text)) {
        legacyTokenViolations.push(`${relative(ROOT, file)}  contains a legacy var(--color-surface-...) class`)
      }
      if (LEGACY_IMPORT_RE.test(text)) {
        legacyImportViolations.push(`${relative(ROOT, file)}  imports directly from agent-ops/_legacy/*`)
      }
      if (notYetMigrated.has(relFromApp)) {
        shouldBeRemovedFromList.push(
          `${relative(ROOT, file)}  imports from views/ but is still listed in scripts/not-yet-migrated.json — remove it from the list`
        )
      }
    } else {
      if (!notYetMigrated.has(relFromApp)) {
        missingFromList.push(
          `${relative(ROOT, file)}  does not import from @/components/views/ and is not in scripts/not-yet-migrated.json — half-done migration`
        )
      }
    }
  }

  const viewMissingLayoutPrimitive = []
  for await (const file of walk(VIEWS_DIR)) {
    const text = await readFile(file, 'utf8')
    if (!LAYOUT_PRIMITIVE_IMPORT_RE.test(text)) {
      viewMissingLayoutPrimitive.push(`${relative(ROOT, file)}  does not import Panel/Section/PageLayout`)
    }
  }

  let failed = false
  const report = (title, violations) => {
    if (violations.length === 0) return
    failed = true
    console.error(`\n✗ ${violations.length} ${title}:\n`)
    for (const v of violations) console.error('  ' + v)
  }

  report('migrated page.tsx over the 20-line budget', lineCountViolations)
  report('migrated page.tsx with a legacy --color-surface-* class', legacyTokenViolations)
  report('migrated page.tsx importing agent-ops/_legacy/* directly', legacyImportViolations)
  report('migrated page.tsx still listed in not-yet-migrated.json', shouldBeRemovedFromList)
  report('unmigrated page.tsx missing from not-yet-migrated.json', missingFromList)
  report('view(s) under components/views/ missing a Panel/Section/PageLayout import', viewMissingLayoutPrimitive)

  if (failed) {
    console.error('\nViews guard FAILED.\n')
    process.exit(1)
  }
  // The old wording claimed "every admin route", which this guard never
  // checked: it reads page.tsx files ONLY, so a route whose logic sits in a
  // layout or an error boundary was never looked at while the line said it was.
  // Say what was actually read, and name what was not.
  console.log(
    `✓ Views guard passed — ${inspectedPages.length} admin page.tsx inspected, each either migrated cleanly or tracked in not-yet-migrated.json.`
  )
  console.log(
    `  ${exemptNonPageFiles.length} non-page file(s) under src/app/admin/ are outside this guard (layout/loading/error/not-found — see the header):`
  )
  for (const f of exemptNonPageFiles) console.log('    ' + f)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
