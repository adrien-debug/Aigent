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
 *    doctrine ;
 *  · les surfaces Factory reconstruites n'introduisent pas de couleurs
 *    structurelles brutes interdites (hors thème global et exceptions média marquées).
 *
 * Ce qu'elle NE GARANTIT PAS : le rendu des écrans, la hiérarchie des surfaces,
 * le responsive, ni l'absence de commentaires zéro-scroll dans des composants.
 *
 * Voir `AGENTS.md` § Frontend — doctrine design historique.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
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

function walkFiles(relDir) {
  const root = join(ROOT, relDir)
  if (!existsSync(root)) return []
  const out = []
  const stack = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    const entries = readdirSync(current)
    for (const entry of entries) {
      const abs = join(current, entry)
      const stats = statSync(abs)
      if (stats.isDirectory()) {
        stack.push(abs)
        continue
      }
      out.push(abs)
    }
  }
  return out.map((abs) => abs.slice(ROOT.length + 1))
}

function stripCodeComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

function scanFactoryDoctrine() {
  // PÉRIMÈTRE — il couvre désormais le KIT et les surfaces reconstruites.
  //
  // Il s'est longtemps arrêté à sept dossiers produit. Deux trous en
  // découlaient, et la gate affichait « 0 violation » sans pouvoir les voir :
  //  · `src/components/ui/**` (Catalyst) portait sa PROPRE couche esthétique
  //    (`zinc-*`, `white`, `dark:`) — une seconde autorité visuelle, rendue par
  //    43 fichiers produit via `Text`, 35 via `Badge`, 12 via `Button` ;
  //  · `builder`, `projects`, `lab`, `app/error.tsx` échappaient au scan et y
  //    ont laissé passer `bg-white/4`, `hover:text-white`, `text-white`.
  const scanRoots = [
    'src/components/ui',
    'src/components/agents',
    'src/components/qualification',
    'src/components/delivery',
    'src/components/runtime',
    'src/components/learning',
    'src/components/runs',
    'src/components/cockpit',
    'src/components/builder',
    'src/components/projects',
    'src/components/lab',
    'src/components/app-shell.tsx',
    'src/app/error.tsx',
    'src/app/globals.css',
  ]
  const fileRegex = /\.(ts|tsx|css)$/
  const mediaExceptionMarker = 'DS_FACTORY_MEDIA_EXCEPTION'
  const findings = []
  const scannedFiles = []

  const checks = [
    { name: 'zinc-*', re: /\bzinc-[\w/-]+/g },
    { name: 'gray-*', re: /\bgray-[\w/-]+/g },
    { name: 'slate-*', re: /\bslate-[\w/-]+/g },
    { name: 'dark:*', re: /\bdark:[^\s'"`]+/g },
    { name: 'bg-white', re: /\bbg-white(?:\/[0-9]+)?\b/g },
    { name: 'bg-black', re: /\bbg-black(?:\/[0-9]+)?\b/g },
    { name: 'text-white', re: /\btext-white(?:\/[0-9]+)?\b/g },
    { name: 'text-black', re: /\btext-black(?:\/[0-9]+)?\b/g },
    { name: 'border-white/*', re: /\bborder-white(?:\/[0-9]+)?\b/g },
    { name: 'border-black/*', re: /\bborder-black(?:\/[0-9]+)?\b/g },
    { name: 'stroke-white/*', re: /\bstroke-white(?:\/[0-9]+)?\b/g },
    { name: 'fill-white/*', re: /\bfill-white(?:\/[0-9]+)?\b/g },
    { name: 'hex color', re: /#[0-9a-fA-F]{3,8}\b/g },
    { name: 'rgb/rgba/hsl color', re: /\b(?:rgb|rgba|hsl|hsla)\(/g },
    // ACCENTS TAILWIND BRUTS — le trou par lequel une troisième palette entre.
    // `sky-800`, `amber-500`, `red-500` passaient : la gate ne bannissait que
    // les gris. Un état se dit avec `--aig-severity-*`, qui porte le SENS
    // (bloqué ≠ avertissement) ; une teinte brute ne dit qu'une couleur, et
    // deux surfaces finissent par en choisir deux différentes pour le même
    // état. Les couleurs de marque restent possibles via l'exception média.
    {
      name: 'accent Tailwind brut',
      re: /\b(?:bg|text|ring|border|fill|stroke|divide|outline|shadow|from|via|to|decoration|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|stone|neutral)-\d{2,3}(?:\/[\d.]+)?\b/g,
    },
  ]

  for (const root of scanRoots) {
    const path = join(ROOT, root)
    if (!existsSync(path)) continue
    const paths = statSync(path).isDirectory() ? walkFiles(root) : [root]
    for (const relPath of paths) {
      if (!fileRegex.test(relPath)) continue
      const raw = readFileSync(join(ROOT, relPath), 'utf8')
      const text = stripCodeComments(raw)
      scannedFiles.push(relPath)
      const lines = text.split('\n')
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i]
        if (line.includes(mediaExceptionMarker)) continue
        for (const check of checks) {
          if (
            relPath === 'src/app/globals.css' &&
            (check.name === 'hex color' || check.name === 'rgb/rgba/hsl color')
          ) {
            continue
          }
          if (check.re.test(line)) {
            findings.push(`${relPath}:${i + 1} — ${check.name} interdit (${line.trim()})`)
          }
          check.re.lastIndex = 0
        }
      }
    }
  }

  if (scannedFiles.length === 0) {
    failures.push('factory-scan — aucune cible frontend scannée (gate vacante)')
    return { scannedFiles, findings }
  }

  for (const finding of findings) failures.push(`factory-scan — ${finding}`)
  return { scannedFiles, findings }
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

// 5. Doctrine Factory — interdiction des couleurs structurelles brutes.
const factoryScan = scanFactoryDoctrine()

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
console.log(`  factory-scan: ${factoryScan.scannedFiles.length} fichier(s) frontend scanné(s), ${factoryScan.findings.length} violation(s).`)
