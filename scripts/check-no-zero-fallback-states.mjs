#!/usr/bin/env node
/**
 * No-zero-fallback guard, scoped to this mission's own domain
 * (`src/components/console/states.tsx`, `src/components/console/charts/**`).
 *
 * WHY THIS EXISTS. `?? 0` / `|| 0` on a measurement is how an absent read
 * quietly becomes a fabricated zero — the exact confusion `DataUnavailable`,
 * `EmptyStateIllustrated` and `NoDataChart` exist to prevent. A coercion like
 * that inside the very components meant to render "we couldn't measure this"
 * would defeat their own purpose, so this gate fails on either pattern
 * anywhere in the scoped files. (The repo-wide version of this rule belongs to
 * whichever domain owns the data layer — this one only guards the states/
 * charts library shipped here.)
 *
 * Pure Node, no deps. Run via `npm run check:no-zero-fallback-states`.
 */
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const TARGETS = [join(ROOT, 'src/components/console/states.tsx'), join(ROOT, 'src/components/console/charts')]

const ZERO_FALLBACK = /(\?\?|\|\|)\s*0\b/

async function* files(target) {
  let entries
  try {
    entries = await readdir(target, { withFileTypes: true })
  } catch {
    // Not a directory — treat as a single file.
    yield target
    return
  }
  for (const entry of entries) {
    const full = join(target, entry.name)
    if (entry.isDirectory()) yield* files(full)
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) yield full
  }
}

let violations = []
for (const target of TARGETS) {
  for await (const file of files(target)) {
    const source = await readFile(file, 'utf8').catch(() => null)
    if (source === null) continue
    const lines = source.split('\n')
    lines.forEach((line, index) => {
      if (ZERO_FALLBACK.test(line)) {
        violations.push(`${relative(ROOT, file)}:${index + 1}  ${line.trim()}`)
      }
    })
  }
}

if (violations.length > 0) {
  console.error('✗ check:no-zero-fallback-states — an absent measurement must never render as 0:')
  for (const v of violations) console.error(`  ${v}`)
  process.exitCode = 1
} else {
  console.log('✓ check:no-zero-fallback-states — no `?? 0` / `|| 0` coercion in the states/charts library.')
}
