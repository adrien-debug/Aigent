#!/usr/bin/env node
/**
 * Chart guard — fails if a hand-rolled SVG chart engine reappears.
 *
 * Doctrine globale §Graphiques : « Recharts est le moteur standard », « Aucun
 * moteur graphique maison » ; règles globales, Interdictions : « ne jamais
 * écrire un moteur de graphique maison ». Avant le 26/07/2026 ce repo violait
 * les deux — 557 lignes de SVG à la main dans dashboard-charts/. La règle vaut
 * maintenant par un outil, pas par une phrase dans un .md.
 *
 * Ce que la gate cherche : les marqueurs d'un TRACÉ construit à la main
 * (<polyline>, <polygon>, <path d=…>, <circle>, un <rect> positionné, une
 * viewBox) dans les surfaces dashboard. Ce qu'elle laisse passer :
 *   - les icônes (un <svg> décoratif n'est pas un moteur de graphique) ;
 *   - <defs>/<linearGradient>, que Recharts lui-même demande ;
 *   - une barre de progression HTML (<div> à width en %) — ce n'est pas un
 *     graphique, l'imposer à Recharts serait du zèle.
 *
 * Pure Node, no deps. Run via `npm run check:charts`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

// Surfaces produit où un graphique peut apparaître.
const SCAN_DIRS = [
  join('app', 'admin'),
  join('components', 'agent-ops'),
  join('components', 'views'),
  join('components', 'shell'),
]

// Un moteur de graphique maison se reconnaît à une géométrie CALCULÉE : des
// coordonnées interpolées depuis des données (`x={i * STEP}`, `points={…map…}`,
// une échelle `scale(...)`). Un logo, un spinner ou une icône ont des
// coordonnées LITTÉRALES et ne dérivent d'aucune donnée — ce ne sont pas des
// graphiques, la gate ne doit pas les toucher.
const PLOT_MARKERS = [
  { re: /<(?:polyline|polygon)\b[^>]*\bpoints=\{/g, what: 'points={…} calculé (série tracée à la main)' },
  { re: /<path\b[^>]*\bd=\{/g, what: 'd={…} calculé (courbe tracée à la main)' },
  { re: /<(?:rect|circle|line)\b[^>]*\b(?:x|cx|x1)=\{/g, what: 'coordonnée calculée (barre/point placé à la main)' },
]

/** Fichiers autorisés à contenir ces marqueurs, avec la raison. */
const ALLOWLIST = new Map([
  // Recharts a besoin d'un <defs><linearGradient> pour le remplissage d'aire.
  // Ce fichier ne trace aucune série lui-même : il configure Recharts.
  ['components/agent-ops/dashboard-charts/chart-primitives.tsx', 'wrappers Recharts (defs/linearGradient uniquement)'],
  // Arête de graphe React Flow : une courbe de Bézier entre deux nœuds
  // positionnés par la lib, pas une série de données.
  ['components/agent-ops/project-team/project-team-edge.tsx', 'arête React Flow, pas une série'],
])

async function* walk(dir) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (/\.(tsx|jsx)$/.test(entry.name)) yield full
  }
}

const violations = []

for (const dir of SCAN_DIRS) {
  for await (const file of walk(join(SRC, dir))) {
    const rel = relative(SRC, file).split('\\').join('/')
    if (ALLOWLIST.has(rel)) continue

    const source = await readFile(file, 'utf8')
    for (const { re, what } of PLOT_MARKERS) {
      re.lastIndex = 0
      const hits = source.match(re)
      if (hits) violations.push({ rel, what, count: hits.length })
    }
  }
}

if (violations.length > 0) {
  console.error('✗ Chart guard FAILED — moteur de graphique maison détecté.\n')
  for (const v of violations) {
    console.error(`  src/${v.rel}`)
    console.error(`    ${v.count}× ${v.what}`)
  }
  console.error('\n  Doctrine globale §Graphiques : Recharts est le moteur standard,')
  console.error('  ECharts l\'étage data-science. Aucun moteur maison.')
  console.error('  → utilise les wrappers de components/agent-ops/dashboard-charts/chart-primitives.tsx')
  console.error('  → une barre de progression HTML (<div> width %) reste permise, ce n\'est pas un graphique.')
  process.exit(1)
}

console.log('✓ Chart guard passed — aucun moteur de graphique maison ; les tracés passent par Recharts.')
