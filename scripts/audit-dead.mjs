#!/usr/bin/env node
/**
 * Dead-code gate — fails CI when unreferenced components are found.
 * Run via `npm run audit:dead`.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, acc)
    else if (/\.(tsx|ts|mjs|js)$/.test(entry.name)) acc.push(full)
  }
  return acc
}

function rg(pattern, exclude = '') {
  try {
    const glob = exclude ? `--glob '!${exclude}'` : ''
    const out = execSync(`rg -l ${glob} -F '${pattern.replace(/'/g, "'\\''")}' src tests scripts 2>/dev/null || true`, {
      encoding: 'utf8',
    }).trim()
    return out ? out.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

function isReferenced(file) {
  const rel = file.replace(/\\/g, '/')
  const noExt = rel.replace(/\.(tsx|ts|mjs|js)$/, '')
  const base = path.basename(noExt)
  const importPath = '@/' + noExt.replace(/^src\//, '')

  const patterns = [importPath, `./${base}`, `../${base}`, `/${base}'`, `/${base}"`, `/${base}.tsx`, `/${base}.ts`]
  for (const p of patterns) {
    if (rg(p, rel).length > 0) return true
  }
  return false
}

const componentFiles = walk('src/components')
const deadComponents = componentFiles.filter((f) => !isReferenced(f)).map((f) => f.replace(/\\/g, '/'))

if (deadComponents.length > 0) {
  console.error(`✗ ${deadComponents.length} dead component(s):\n`)
  for (const f of deadComponents.sort()) console.error('  ' + f)
  process.exit(1)
}

console.log(`✓ No dead components (${componentFiles.length} checked).`)
