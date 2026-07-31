#!/usr/bin/env node
/**
 * Legacy-front guard — fails if the DEMOLISHED visual layer reappears.
 *
 * Ce que cette gate garde, et ce qu'elle ne garde plus.
 *
 * `mission/frontend-reset` avait supprimé tout le front, y compris
 * `src/components/`. Un premier bloc UI a été réintroduit le 2026-07-31 sur ordre
 * explicite d'Adrien — `src/components/` est donc de nouveau LÉGITIME et n'est
 * plus interdit ici. Le reconstruire est le plan, pas une régression.
 *
 * Ce qui reste interdit est ce qui a été supprimé pour de bonnes raisons et ne
 * doit pas ressusciter en silence : la console `/admin`, le site marketing, la
 * page `/login`, le fichier de tokens `src/theme.css`, les artefacts du pilote
 * de design. Le futur front est free design (CLAUDE.md §8) : il se construit
 * sur ses propres bases, il ne réanime pas les anciennes.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()

/** Répertoires démolis qui ne doivent PAS revenir. */
const FORBIDDEN_DIRS = [
  'design',
  'docs/visual-reviews',
  'src/app/admin',
  'src/app/(site)',
  'src/app/login',
]

/** Fichiers démolis qui ne doivent PAS revenir. */
const FORBIDDEN_FILES = [
  'src/theme.css',
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

/**
 * Imports pointant vers une couche démolie. `@/components/` n'en fait plus partie
 * (le répertoire est légitime) — mais les sous-arbres de l'ANCIENNE console, eux,
 * restent interdits : les réimporter ressusciterait le front supprimé.
 */
const FORBIDDEN_IMPORT_PREFIXES = [
  '@/components/console/',
  'src/components/console/',
  '@/components/agent-ops/',
  '@/components/views/',
  '@/components/shell/',
  '@/components/marketing/',
  '@/theme.css',
]

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

  let scanned = 0
  for await (const file of walk(join(ROOT, 'src'))) {
    scanned += 1
    const content = await readFile(file, 'utf8')
    for (const prefix of FORBIDDEN_IMPORT_PREFIXES) {
      if (content.includes(prefix)) {
        failures.push(`forbidden import in ${file.replace(ROOT + '/', '')}: ${prefix}`)
      }
    }
  }
  // Anti-cécité : un scan qui n'ouvre aucun fichier ne prouve rien.
  if (scanned === 0) failures.push('import scan opened 0 file under src/ — the guard measured nothing')
  return scanned
}

const scanned = await scanForbiddenImports()

if (failures.length > 0) {
  console.error('✗ Legacy-front guard failed:\n')
  for (const f of failures) console.error('  ' + f)
  process.exit(1)
}

console.log('✓ Legacy-front guard passed — no demolished visual layer on disk.')
console.log(`  ${scanned} fichier(s) scanné(s) sous src/ ; src/components/ est autorisé (front en reconstruction).`)
