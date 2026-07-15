#!/usr/bin/env node
/**
 * Catalyst guard — fails CI if the dashboard drifts off the 27 Catalyst
 * primitives in components/catalyst/.
 *
 * Scope: src/app/admin/** and src/components/agent-ops/** (the interactive
 * dashboard). NOT src/app/(site)/** or src/components/marketing/** (the
 * marketing site is plain Tailwind blocks by design — see /catalyst docs).
 * NOT components/catalyst/** itself (the primitives own the native markup).
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

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

const DASHBOARD_DIRS = [join('app', 'admin'), join('components', 'agent-ops')]
const EXCLUDE_DIRS = [join('components', 'catalyst')]

const NATIVE_TAG_RE = /<(button|input|select|textarea|table)(?=\s|>|$)/g
// Comments (JSX {/* ... */} or // ...) mentioning the tag are not violations —
// only skip a match if the tag name appears after a comment marker on the
// same line, checked separately below rather than baked into the regex.
const ARBITRARY_SPACING_RE = /\b(?:p|m|gap|space-[xy])-(?:[trblxy]-)?\[[0-9.]+(?:px|rem|em)\]/g
// Inline recomposition of the canon card surface: bg-[var(--color-surface-secondary)]
// hand-written alongside a rounded + border on the same line = a card recopied
// instead of using the `surfaceCardClass` constant. surface-card.tsx owns the
// string. A bare surface-secondary bg (no rounded/border) is a legit inner fill.
const INLINE_CARD_SURFACE_RE = /bg-\[var\(--color-surface-secondary\)\]/
const CARD_ROUNDED_RE = /\brounded(?:-(?:lg|xl|2xl|3xl))?\b(?!-full)/
const CARD_BORDER_RE = /\bborder(?:-white)?\b/

function isDashboardFile(relPath) {
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

function lineIsComment(line) {
  const trimmed = line.trim()
  return trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.includes('{/*')
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
    const lines = text.split('\n')

    lines.forEach((line, i) => {
      if (lineIsComment(line)) return

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
