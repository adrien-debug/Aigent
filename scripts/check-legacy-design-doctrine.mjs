#!/usr/bin/env node
/**
 * Legacy design-doctrine guard — empêche la réinjection d'une ancienne doctrine
 * de design system (zéro-scroll, viewport lock, gates check:ds/check:catalyst,
 * Design System Guardian, quotas de tests UI imposés).
 *
 * Ce que cette gate GARANTIT :
 *  · la doc historique `docs/cockpit-catalyst-migration.md` reste marquée abrogée ;
 *  · `npm run check` ne réintroduit pas les gates layout supprimées ;
 *  · les chemins d'injection automatique (prompts repo-aware, orchestrateur,
 *    recommandations repo-intelligence, sandbox scripts) ne réinjectent pas la
 *    doctrine.
 *
 * Ce qu'elle NE GARANTIT PAS : le rendu des écrans, ni l'absence de commentaires
 * zéro-scroll dans des composants — c'est une mission layout distincte.
 *
 * Voir `AGENTS.md` § Frontend — doctrine design historique.
 */
import { readFileSync, existsSync } from 'node:fs'
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

// 1. Doc historique — bandeau d'abrogation obligatoire.
const migrationDoc = read('docs/cockpit-catalyst-migration.md')
if (migrationDoc) {
  if (!/CE DOCUMENT N'EST PLUS UNE RÈGLE/i.test(migrationDoc)) {
    failures.push('docs/cockpit-catalyst-migration.md — bandeau d\'abrogation absent')
  }
  if (!/NON APPLICABLE/i.test(migrationDoc)) {
    failures.push('docs/cockpit-catalyst-migration.md — marqueur NON APPLICABLE absent')
  }
}

// 2. Chaîne check — gates layout supprimées le 30/07/2026.
const pkg = JSON.parse(read('package.json') || '{}')
const checkChain = String(pkg.scripts?.check ?? '')
const forbiddenInCheck = [
  'check:catalyst',
  'check:ds',
  'check:console-design-system',
  'check:console-branding',
  'check:chart-empty-guard',
  'check:empty-state-explained',
  'check:error-state-not-usable',
  'check:no-zero-fallback-states',
  'check:status-truth',
]
for (const gate of forbiddenInCheck) {
  if (checkChain.includes(gate)) {
    failures.push(`package.json scripts.check réintroduit la gate supprimée: ${gate}`)
  }
}

// 3. Injection automatique — motifs interdits dans les modules qui poussent la doctrine.
const injectionFiles = [
  'src/lib/agent-mission-control/repo-suite-context.ts',
  'src/lib/agent-mission-control/repo-risk-coverage.ts',
  'src/lib/agent-mission-control/repo-intelligence.ts',
  'src/lib/agent-mission-control/mission-orchestrator.ts',
  'src/lib/agent-mission-control/target-repo-sandbox.ts',
  'src/lib/agent-mission-control/agent-builder-run.ts',
]

const forbiddenPatterns = [
  { re: /design-system-guardian/i, label: 'recommandation design-system-guardian' },
  { re: /Design System Guardian/, label: 'participant Design System Guardian' },
  { re: /required\.push\(\s*['"]design_system['"]\s*\)/, label: 'quota design_system obligatoire' },
  { re: /honoring the design-system gate/i, label: 'prompt design-system gate' },
  { re: /check:ds\s*\/\s*check:catalyst/, label: 'référence check:ds/check:catalyst dans prompt' },
  { re: /['"]check:ds['"],\s*['"]check:catalyst['"]/, label: 'check:ds + check:catalyst en liste de scripts' },
]

for (const rel of injectionFiles) {
  const text = read(rel)
  if (!text) continue
  for (const { re, label } of forbiddenPatterns) {
    if (re.test(text)) {
      failures.push(`${rel} — ${label}`)
    }
  }
}

// 4. Règle explicite dans AGENTS.md.
const agents = read('AGENTS.md')
if (
  agents &&
  !/préférences esthétiques externes[\s\S]{0,80}contraintes produit/i.test(agents)
) {
  failures.push('AGENTS.md — règle explicite sur les préférences esthétiques externes absente')
}

if (failures.length > 0) {
  console.error('✗ Legacy design-doctrine guard FAILED:\n')
  for (const f of failures) console.error('  ' + f)
  console.error(
    '\n  La doctrine layout historique (zéro-scroll, viewport lock, DS Guardian,\n' +
      '  gates check:ds/check:catalyst) ne doit pas être réinjectée. Voir AGENTS.md § Frontend.\n'
  )
  process.exit(1)
}

console.log('✓ Legacy design-doctrine guard passed — injection bloquée, doc historique marquée.')
console.log(`  ${injectionFiles.length} module(s) d'injection scanné(s), ${forbiddenInCheck.length} gate(s) layout interdites dans check.`)
