#!/usr/bin/env node
/**
 * Compat layer historique.
 *
 * La gate legacy unique a été scindée en deux responsabilités explicites :
 * - `check:no-legacy-design-governance`
 * - `check:production-visual-authority`
 *
 * Ce script reste invocable pour éviter un point d'entrée mort, mais il délègue
 * strictement aux deux nouvelles gates.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const checks = [
  join(HERE, 'check-no-legacy-design-governance.mjs'),
  join(HERE, 'check-production-visual-authority.mjs'),
]

for (const script of checks) {
  const run = spawnSync(process.execPath, [script], {
    stdio: 'inherit',
    cwd: process.cwd(),
  })
  if (run.status !== 0) process.exit(run.status ?? 1)
}

console.log('✓ Legacy design doctrine split checks passed.')
