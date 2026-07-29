#!/usr/bin/env node
/**
 * Catalyst guard — fails CI if the dashboard drifts off the Catalyst-derived
 * primitives in components/ui/.
 *
 * Scope: src/app/admin/**, src/components/agent-ops/**, src/components/views/**
 * (the catalyst-in-layers migration moved page-level render logic here — see
 * the migration plan), src/components/shell/** (the interactive dashboard) and
 * src/app/login/** — plus, FILE BY FILE, src/app/layout.tsx and
 * src/app/not-found.tsx. Those three last entries are authenticated/app-shell
 * surfaces that happen to sit at the root of src/app/; they are listed one by
 * one on purpose. Scoping `src/app/**` in bulk would drag src/app/(site)/**
 * under the dashboard rules, and AGENTS.md makes marketing a DIFFERENT and
 * deliberate convention (raw Tailwind Plus blocks, no Catalyst primitive).
 * NOT src/app/(site)/** or src/components/marketing/**. NOT components/ui/**
 * itself (the primitives own the native markup).
 *
 * Checks, dashboard scope only:
 *   1) Native interactive elements that have a Catalyst primitive equivalent
 *      (<button> <input> <select> <textarea> <table>) — use Button/Input/
 *      Select/Textarea/Table, or Headless.Button for a custom-styled control
 *      that still needs real button semantics.
 *   2) Arbitrary-value spacing (p-[13px] etc.) — spacing must come off the
 *      fixed Tailwind scale, never a magic pixel value.
 *
 * Pure Node, no deps. Run via `npm run check:catalyst`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { stripComments } from './check-render-truth.mjs'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const DASHBOARD_DIRS = [
  join('app', 'admin'),
  join('components', 'admin-dashboard'),
  join('components', 'admin-shell'),
  join('components', 'runs-console'),
  join('app', 'login'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]
// Root-level app files that belong to the dashboard shell. Named individually —
// never widen this to the directory (see the scope note above).
const DASHBOARD_FILES = [join('app', 'layout.tsx'), join('app', 'not-found.tsx')]
const EXCLUDE_DIRS = [join('components', 'ui')]

const NATIVE_TAG_RE = /<(button|input|select|textarea|table)(?=\s|>|$)/g
// Matches both bare (p-, m-, gap-, space-x-) and directional-glued
// (pt-, pl-, mt-, mx-, ps-, me-, space-x- …) Tailwind spacing utilities.
// Tailwind glues the direction letter straight onto p/m (pt-, pl-, mx-, my-, …)
// — there is no intermediate hyphen — so the axis/direction group must be
// optional letters immediately before the utility's own hyphen, not a
// separate `letter-` segment.
//
// The value side covers every way a magic number gets written, not just
// px/rem/em: `p-[3ch]`, `gap-[2vh]`, `mt-[10%]`, `p-[calc(100%-4px)]` and
// `m-[var(--gap)]` are all the same escape hatch off the fixed scale, spelled
// differently — the narrow unit list let four of the five straight through.
//
// The prefix is anchored with a lookbehind, not `\b`: `\b` matches at the `p`
// of `scroll-p-[3rem]` (a scroll-padding utility, which is not spacing), so
// that class was reported as a violation. A leading `-` is accepted only as
// Tailwind's negative sign (`-mt-[4px]`), never as the tail of a longer
// utility name.
const SPACING_UTILITY = String.raw`(?:[pm][trblxyse]?|gap(?:-[xy])?|space-[xy])`
const SPACING_VALUE = String.raw`(?:[0-9.]+(?:px|rem|em|ch|ex|vh|vw|vmin|vmax|%)|calc\([^\]]*\)|var\(--[^)]*\)[^\]]*)`
const ARBITRARY_SPACING_RE = new RegExp(String.raw`(?<![\w-])-?${SPACING_UTILITY}-\[${SPACING_VALUE}\]`, 'g')
// Inline recomposition of the canon card surface: bg-[var(--color-surface-secondary)]
// hand-written alongside a rounded + border on the same line = a card recopied
// instead of using the `surfaceCardClass` constant. surface-card.tsx owns the
// string. A bare surface-secondary bg (no rounded/border) is a legit inner fill.
const INLINE_CARD_SURFACE_RE = /bg-\[var\(--color-surface-secondary\)\]/
const CARD_ROUNDED_RE = /\brounded(?:-(?:lg|xl|2xl|3xl))?\b(?!-full)/
const CARD_BORDER_RE = /\bborder(?:-white)?\b/

function isDashboardFile(relPath) {
  if (DASHBOARD_FILES.includes(relPath)) return true
  return DASHBOARD_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

function isExcluded(relPath) {
  return EXCLUDE_DIRS.some((dir) => relPath.startsWith(dir + '/') || relPath === dir)
}

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

async function main() {
  const nativeTagViolations = []
  const spacingViolations = []
  const inlineCardViolations = []

  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (!isDashboardFile(rel) || isExcluded(rel)) continue
    // surface-card.tsx owns the canon card-surface string.
    const isSurfaceSource = rel.endsWith(join('components', 'agent-ops', 'surface-card.tsx'))

    const text = await readFile(file, 'utf8')
    // Comments are blanked, not skipped, by the ONE stripper this repo owns
    // (scripts/check-render-truth.mjs). The former line-level skip disarmed the
    // whole line as soon as it contained `{/*` — so `<button/> {/* why */}`, a
    // native tag with a trailing JSX comment, walked straight past every check.
    // stripComments() also tracks multi-line block state, which a per-line
    // `startsWith('*')` heuristic only approximated.
    const lines = stripComments(text)

    lines.forEach((line, i) => {
      NATIVE_TAG_RE.lastIndex = 0
      let m
      while ((m = NATIVE_TAG_RE.exec(line))) {
        nativeTagViolations.push(`${relative(ROOT, file)}:${i + 1}  <${m[1]}> — use the Catalyst primitive instead`)
      }

      ARBITRARY_SPACING_RE.lastIndex = 0
      while ((m = ARBITRARY_SPACING_RE.exec(line))) {
        spacingViolations.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]} — use the fixed spacing scale`)
      }

      // Inline-recomposed card surface (surface-secondary bg + rounded + border
      // on one line) instead of importing `surfaceCardClass`.
      if (
        !isSurfaceSource &&
        INLINE_CARD_SURFACE_RE.test(line) &&
        CARD_ROUNDED_RE.test(line) &&
        CARD_BORDER_RE.test(line)
      ) {
        inlineCardViolations.push(`${relative(ROOT, file)}:${i + 1}  inline card surface — import \`surfaceCardClass\` instead of recopying the class string`)
      }
    })
  }

  let failed = false
  if (nativeTagViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${nativeTagViolations.length} native element(s) in the dashboard (Catalyst primitives only):\n`)
    for (const v of nativeTagViolations) console.error('  ' + v)
  }
  if (spacingViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${spacingViolations.length} arbitrary spacing value(s) (fixed scale only):\n`)
    for (const v of spacingViolations) console.error('  ' + v)
  }
  if (inlineCardViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${inlineCardViolations.length} inline-recomposed card surface(s) (use surfaceCardClass):\n`)
    for (const v of inlineCardViolations) console.error('  ' + v)
  }

  if (failed) {
    console.error('\nCatalyst guard FAILED.\n')
    process.exit(1)
  }
  console.log('✓ Catalyst guard passed — dashboard uses Catalyst primitives only, fixed spacing scale.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
