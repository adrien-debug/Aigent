#!/usr/bin/env node
/**
 * Dead-code gate — fails CI when unreferenced components are found.
 * Pure Node (no ripgrep) so it runs on GitHub Actions runners too.
 */
import fs from 'node:fs'
import path from 'node:path'

const CORPUS_ROOTS = ['src', 'tests', 'scripts']

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      walk(full, acc)
    } else if (/\.(tsx|ts|mjs|js|md)$/.test(entry.name)) {
      acc.push(full)
    }
  }
  return acc
}

function loadCorpus() {
  return CORPUS_ROOTS.flatMap((root) => walk(root)).map((file) => ({
    rel: file.replace(/\\/g, '/'),
    content: fs.readFileSync(file, 'utf8'),
  }))
}

function isReferenced(componentFile, corpus) {
  const rel = componentFile.replace(/\\/g, '/')
  const noExt = rel.replace(/\.(tsx|ts)$/, '')
  const base = path.basename(noExt)
  const importPath = '@/' + noExt.replace(/^src\//, '')

  const needles = [
    importPath,
    `./${base}`,
    `../${base}`,
    `'/${base}'`,
    `"/${base}"`,
    `'/${base}.tsx'`,
    `'/${base}.ts'`,
  ]

  for (const { rel: fileRel, content } of corpus) {
    if (fileRel === rel) continue
    for (const needle of needles) {
      if (content.includes(needle)) return true
    }
  }
  return false
}

const componentFiles = walk('src/components').filter((f) => /\.(tsx|ts)$/.test(f))
const corpus = loadCorpus()
const deadComponents = componentFiles.filter((f) => !isReferenced(f, corpus)).map((f) => f.replace(/\\/g, '/'))

if (deadComponents.length > 0) {
  console.error(`✗ ${deadComponents.length} dead component(s):\n`)
  for (const f of deadComponents.sort()) console.error('  ' + f)
  process.exit(1)
}

console.log(`✓ No dead components (${componentFiles.length} checked).`)
