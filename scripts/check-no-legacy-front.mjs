#!/usr/bin/env node
/**
 * Frontend-reset guard — fails if the demolished visual layer reappears.
 *
 * After mission/frontend-reset the product surface is intentionally empty:
 * one root page, API routes, no `src/components/`, no `/admin` pages, no marketing
 * site, no design pilot artifacts. This gate prevents silent resurrection.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Directories that must NOT exist after the reset. */
const FORBIDDEN_DIRS = [
  'src/components',
  'design',
  'docs/visual-reviews',
  'src/app/admin',
  'src/app/(site)',
  'src/app/login',
]

/** Files that must NOT exist after the reset. */
const FORBIDDEN_FILES = [
  'src/theme.css',
]

/** Legacy import prefixes — any match under `src/` is a regression. */
const FORBIDDEN_IMPORT_PREFIXES = [
  '@/components/',
  'src/components/',
]

const failures = []

for (const rel of FORBIDDEN_DIRS) {
  if (existsSync(join(ROOT, rel))) failures.push(`forbidden directory still present: ${rel}`)
}

for (const rel of FORBIDDEN_FILES) {
  if (existsSync(join(ROOT, rel))) failures.push(`forbidden file still present: ${rel}`)
}

// Minimal skeleton must exist.
const REQUIRED_FILES = ['src/app/page.tsx', 'src/app/layout.tsx', 'src/app/globals.css']
for (const rel of REQUIRED_FILES) {
  if (!existsSync(join(ROOT, rel))) failures.push(`required skeleton file missing: ${rel}`)
}

async function scanForbiddenImports() {
  const { readdir, readFile } = await import('node:fs/promises')
  async function* walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules') continue
        yield* walk(full)
      } else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) {
        yield full
      }
    }
  }

  for await (const file of walk(join(ROOT, 'src'))) {
    const content = await readFile(file, 'utf8')
    for (const prefix of FORBIDDEN_IMPORT_PREFIXES) {
      if (content.includes(prefix)) {
        failures.push(`forbidden import in ${file.replace(ROOT + '/', '')}: ${prefix}`)
      }
    }
  }
}

await scanForbiddenImports()

if (failures.length > 0) {
  console.error('✗ Frontend-reset guard failed:\n')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

console.log('✓ Frontend-reset guard passed — no historical visual layer on disk.')
