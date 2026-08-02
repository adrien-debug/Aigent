#!/usr/bin/env node
/**
 * Gate AIGENT-DS-REFACTOR-001 — fondation tokens / theme.
 *
 * Vérifie que :
 *  - les valeurs canoniques `--aig-*` n'ont pas bougé (source de vérité) ;
 *  - `--aig-radius` pointe sur `--radius-md` ;
 *  - l'échelle radius 4/8/16 est déclarée dans `@theme` ;
 *  - les alias sémantiques ne dupliquent pas de littéraux ;
 *  - `globals.css` importe `src/theme/*`.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const errors = []

function read(rel) {
  return readFileSync(join(ROOT, rel), 'utf8')
}

const tokens = read('src/theme/tokens.css')
const globals = read('src/app/globals.css')
const utilities = read('src/theme/utilities.css')

const CANONICAL_LITERALS = [
  '--aig-base: oklch(0.19 0.006 264)',
  '--aig-subtle: oklch(0.16 0.006 264)',
  '--aig-raised: oklch(0.24 0.008 264)',
  '--aig-line: oklch(0.32 0.008 264)',
  '--aig-line-soft: oklch(0.27 0.008 264)',
  '--aig-text: oklch(0.93 0.004 264)',
  '--aig-text-muted: oklch(0.71 0.006 264)',
  '--aig-text-faint: oklch(0.58 0.006 264)',
  '--aig-text-display: oklch(0.97 0.004 250)',
  '--aig-accent: oklch(0.72 0.11 52)',
  '--aig-accent-quiet: oklch(0.45 0.06 52)',
  '--aig-severity-good: #0da87f',
  '--aig-severity-running: #3d82ee',
  '--aig-severity-warn: #be850f',
  '--aig-severity-blocked: #8e63ee',
  '--aig-severity-bad: #e8455f',
]

for (const line of CANONICAL_LITERALS) {
  if (!tokens.includes(line)) {
    errors.push(`valeur canonique manquante ou modifiée : ${line}`)
  }
}

if (!tokens.includes('--aig-radius: var(--radius-md)')) {
  errors.push('--aig-radius doit référencer var(--radius-md)')
}

for (const [name, value] of [
  ['--radius-sm', '0.25rem'],
  ['--radius-md', '0.5rem'],
  ['--radius-lg', '1rem'],
]) {
  if (!tokens.includes(`${name}: ${value}`)) {
    errors.push(`échelle radius manquante : ${name}: ${value}`)
  }
}

const ALIAS_LINES = [
  '--surface-canvas: var(--aig-subtle)',
  '--surface-primary: var(--aig-base)',
  '--surface-elevated: var(--aig-raised)',
  '--border-subtle: var(--aig-line-soft)',
  '--border-default: var(--aig-line)',
  '--shadow-sm: var(--aig-elevation-flat)',
  '--shadow-md: var(--aig-elevation-raised)',
  '--shadow-lg: var(--aig-elevation-overlay)',
]

for (const line of ALIAS_LINES) {
  if (!tokens.includes(line)) {
    errors.push(`alias sémantique manquant : ${line}`)
  }
}

const aliasBlock = tokens.slice(tokens.indexOf('/* Alias sémantiques'))
for (const line of aliasBlock.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('--')) continue
  if (trimmed.includes('oklch(') || /#[0-9a-f]{3,8}/i.test(trimmed)) {
    errors.push(`alias sémantique ne doit pas porter de littéral : ${trimmed}`)
  }
}

if (!globals.includes('@import "../theme/tokens.css"')) {
  errors.push('globals.css doit importer src/theme/tokens.css')
}
if (!globals.includes('@import "../theme/utilities.css"')) {
  errors.push('globals.css doit importer src/theme/utilities.css')
}

if (!utilities.includes('@utility aig-panel')) {
  errors.push('utilities.css doit déclarer @utility aig-panel')
}

if (!utilities.includes('border-radius: var(--radius-lg)')) {
  errors.push('aig-stage doit utiliser var(--radius-lg)')
}

if (!utilities.includes('border-radius: var(--radius-sm)')) {
  errors.push('aig-inset doit utiliser var(--radius-sm)')
}

if (errors.length > 0) {
  console.error('✗ theme-foundation FAILED\n')
  for (const err of errors) console.error(`  · ${err}`)
  process.exit(1)
}

console.log('✓ theme-foundation passed.')
