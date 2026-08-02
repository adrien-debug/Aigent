#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const failures = []
const violations = []
const scannedFiles = []
const excludedFiles = []

const INCLUDE_ROOTS = ['src/app', 'src/components', 'src/lib/cockpit']
const FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|css)$/

const EXCLUSIONS = [
  { re: /^src\/app\/api\//, reason: 'surface API non visuelle' },
  { re: /^src\/app\/lab\//, reason: 'Lab/Composer = zone exploration' },
  { re: /^src\/components\/lab\//, reason: 'Lab/Composer = zone exploration' },
  { re: /^src\/components\/visualizations\//, reason: 'visualisations externes/médias' },
  { re: /^src\/app\/globals\.css$/, reason: 'fichier global de tokens' },
]

function walk(relDir) {
  const absRoot = join(ROOT, relDir)
  if (!existsSync(absRoot)) return []
  const out = []
  const stack = [absRoot]
  while (stack.length > 0) {
    const cur = stack.pop()
    for (const entry of readdirSync(cur)) {
      const abs = join(cur, entry)
      const stats = statSync(abs)
      if (stats.isDirectory()) {
        stack.push(abs)
      } else {
        out.push(abs.slice(ROOT.length + 1))
      }
    }
  }
  return out
}

function stripCommentsKeepStrings(text) {
  let out = ''
  let state = 'code'
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    const next = text[i + 1]
    if (state === 'code') {
      if (c === '/' && next === '*') {
        state = 'block'
        i += 1
        continue
      }
      if (c === '/' && next === '/') {
        state = 'line'
        i += 1
        continue
      }
      if (c === "'" || c === '"' || c === '`') state = c
      out += c
      continue
    }
    if (state === 'line') {
      if (c === '\n') {
        state = 'code'
        out += c
      }
      continue
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        state = 'code'
        i += 1
      }
      continue
    }
    out += c
    if (c === '\\') {
      out += text[i + 1] ?? ''
      i += 1
      continue
    }
    if (c === state) state = 'code'
  }
  return out
}

function exclusionReason(path) {
  for (const rule of EXCLUSIONS) {
    if (rule.re.test(path)) return rule.reason
  }
  return null
}

const RAW_ACCENT =
  /\b(?:bg|text|ring|border|fill|stroke|divide|outline|shadow|from|via|to|decoration|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|stone|neutral)-\d{2,3}(?:\/[\d.]+)?\b/g
const RAW_LITERAL = /\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\(|#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})/g
const STATUS_CONTEXT = /\b(status|blocked|failed|running|needs-confirmation|completed|error|success)\b/i

for (const root of INCLUDE_ROOTS) {
  for (const relPath of walk(root)) {
    if (!FILE_RE.test(relPath)) continue
    const reason = exclusionReason(relPath)
    if (reason) {
      excludedFiles.push({ path: relPath, reason })
      continue
    }

    const raw = readFileSync(join(ROOT, relPath), 'utf8')
    const text = stripCommentsKeepStrings(raw)
    const hasAgentRunStatusType = /\bAgentRunStatus\b/.test(text)
    scannedFiles.push(relPath)
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]
      if (line.includes('DS_FACTORY_MEDIA_EXCEPTION')) continue

      if (RAW_ACCENT.test(line) && STATUS_CONTEXT.test(line)) {
        violations.push(`${relPath}:${i + 1} raw status accent interdit (${line.trim()})`)
      }
      RAW_ACCENT.lastIndex = 0
      STATUS_CONTEXT.lastIndex = 0

      if (
        hasAgentRunStatusType &&
        /const\s+RUN_STATUS_COLOR/.test(line) &&
        relPath !== 'src/lib/cockpit/status.ts'
      ) {
        violations.push(`${relPath}:${i + 1} redéfinition locale RUN_STATUS_COLOR interdite`)
      }

      if (RAW_LITERAL.test(line)) {
        const hasTokenRef = /var\(--aig-[a-z-]+/.test(line)
        const hasSeveritySource = relPath === 'src/lib/cockpit/status.ts'
        if (!hasTokenRef && !hasSeveritySource) {
          violations.push(`${relPath}:${i + 1} couleur littérale hors autorité thème (${line.trim()})`)
        }
      }
      RAW_LITERAL.lastIndex = 0
    }
  }
}

if (scannedFiles.length === 0) {
  failures.push('gate sans cible: aucun fichier de surface production scanné')
}

for (const v of violations) failures.push(v)

if (failures.length > 0) {
  console.error('✗ production-visual-authority FAILED\n')
  console.error('fichiers scannés:')
  for (const file of scannedFiles) console.error(`  - ${file}`)
  console.error('\nfichiers exclus:')
  for (const excluded of excludedFiles) console.error(`  - ${excluded.path} (${excluded.reason})`)
  console.error('\nviolations:')
  for (const f of failures) console.error(`  - ${f}`)
  process.exit(1)
}

console.log('✓ production-visual-authority passed.')
console.log('fichiers scannés:')
for (const file of scannedFiles) console.log(`  - ${file}`)
console.log('fichiers exclus:')
for (const excluded of excludedFiles) {
  console.log(`  - ${excluded.path} (${excluded.reason})`)
}
console.log('violations: 0')
