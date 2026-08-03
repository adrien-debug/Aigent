#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const failures = []

function read(rel) {
  const path = join(ROOT, rel)
  if (!existsSync(path)) {
    failures.push(`missing file: ${rel}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

const migrationDoc = read('docs/cockpit-catalyst-migration.md')
if (migrationDoc) {
  if (!/CE DOCUMENT N'EST PLUS UNE RÈGLE/i.test(migrationDoc)) {
    failures.push("docs/cockpit-catalyst-migration.md — bandeau d'abrogation absent")
  }
  if (!/NON APPLICABLE/i.test(migrationDoc)) {
    failures.push('docs/cockpit-catalyst-migration.md — marqueur NON APPLICABLE absent')
  }
}

const pkg = JSON.parse(read('package.json') || '{}')
const checkChain = String(pkg.scripts?.check ?? '')
const forbiddenInCheck = ['check:catalyst', 'check:ds']
for (const gate of forbiddenInCheck) {
  if (checkChain.includes(gate)) {
    failures.push(`package.json scripts.check réintroduit une gate legacy: ${gate}`)
  }
}

const guardedFiles = [
  'src/lib/agent-mission-control/repo-suite-context.ts',
  'src/lib/agent-mission-control/repo-risk-coverage.ts',
  'src/lib/agent-mission-control/repo-intelligence.ts',
  'src/lib/agent-mission-control/mission-orchestrator.ts',
  'src/lib/agent-mission-control/target-repo-sandbox.ts',
  'src/lib/agent-mission-control/agent-builder-run.ts',
]

const forbiddenPatterns = [
  { re: /Design System Guardian/i, label: 'Design System Guardian réinjecté' },
  { re: /z[eé]ro-scroll\s+obligatoire/i, label: 'zéro-scroll obligatoire réinjecté' },
  { re: /viewport lock/i, label: 'viewport lock réinjecté' },
  { re: /check:ds\s*\/\s*check:catalyst/i, label: 'référence check:ds/check:catalyst' },
  { re: /['"]check:ds['"],\s*['"]check:catalyst['"]/i, label: 'check:ds/check:catalyst en liste scripts' },
  { re: /required\.push\(\s*['"]design_system['"]\s*\)/i, label: 'quota design_system obligatoire' },
  { re: /quota(?:s)?\s+(?:arbitraire(?:s)?\s+)?de\s+tests?\s+(?:ui|visuels?|frontend)/i, label: 'quota arbitraire tests UI' },
  { re: /(?:sync|synchronis\w+)\s+(?:automatique\s+)?(?:de\s+)?gouvernance/i, label: 'sync automatique gouvernance' },
  { re: /governance\s+sha/i, label: 'dépendance doctrine externe SHA' },
]

let scannedFiles = 0
for (const rel of guardedFiles) {
  const text = read(rel)
  if (!text) continue
  scannedFiles += 1
  for (const { re, label } of forbiddenPatterns) {
    if (re.test(text)) failures.push(`${rel} — ${label}`)
  }
}

if (scannedFiles === 0) {
  failures.push('aucun fichier de gouvernance/injection scanné')
}

// L'abrogation de l'ancienne doctrine design appartient au fichier qui fait
// autorité sur le design. Elle vivait dans AGENTS.md quand celui-ci portait
// encore des règles de surface ; depuis la refonte de gouvernance,
// DESIGN_DOCTRINE.md est le propriétaire et AGENTS.md ne contient plus aucune
// règle visuelle. Chercher l'abrogation ici, c'est la chercher là où un lecteur
// qui doute du design ira réellement regarder.
const designDoctrine = read('DESIGN_DOCTRINE.md')
if (!designDoctrine) {
  failures.push('DESIGN_DOCTRINE.md — fichier absent (autorité design attendue)')
} else if (!/Doctrine design historique\s+—\s+non applicable/i.test(designDoctrine)) {
  failures.push('DESIGN_DOCTRINE.md — mention "Doctrine design historique — non applicable" absente')
}

if (failures.length > 0) {
  console.error('✗ no-legacy-design-governance FAILED:\n')
  for (const f of failures) console.error(`  ${f}`)
  process.exit(1)
}

console.log('✓ no-legacy-design-governance passed.')
console.log(`  fichiers scannés: ${scannedFiles}`)
console.log(`  scripts legacy interdits dans check: ${forbiddenInCheck.join(', ')}`)
