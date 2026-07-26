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
 * ANTI-CÉCITÉ (sonde du 26/07/2026) — une gate verte peut mentir. Trois trous
 * mesurés puis bouchés ici :
 *   1. `ROOT = process.cwd()` : lancée depuis un autre dossier que la racine du
 *      repo, la gate ne trouvait aucun `src/`, `walk()` avalait l'ENOENT et elle
 *      sortait 0 en n'ayant RIEN lu (prouvé : `cd src && node ../scripts/
 *      check-charts.mjs` → exit 0). La racine se déduit maintenant de l'URL du
 *      script, jamais du cwd de l'appelant.
 *   2. Un dossier de SCAN_DIRS renommé (le refactor `components/catalyst` →
 *      `components/ui` a déjà déplacé un périmètre entier) rendait la gate
 *      muette sur cette surface, sans un mot.
 *   3. Une entrée d'ALLOWLIST pointant sur un fichier disparu restait en place :
 *      dispense silencieuse, et surtout signe que le fichier surveillé a bougé.
 * Ces trois cas ÉCHOUENT désormais au lieu de passer.
 *
 * Pure Node, no deps. Run via `npm run check:charts`.
 */
import { readdir, readFile, access } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// La racine vient du fichier lui-même : la gate doit mesurer LE repo qu'elle
// garde, pas le dossier depuis lequel on l'a lancée.
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
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

// `.ts`/`.mjs` sont scannés eux aussi : rien n'oblige un moteur maison à vivre
// dans un `.tsx` — un helper qui assemble une chaîne SVG dans un `.ts` est le
// même moteur. Vérifié : zéro occurrence aujourd'hui, donc aucun faux positif.
const SCANNED_EXT = /\.(tsx|jsx|ts|js|mjs)$/

async function* walk(dir) {
  // Un ENOENT ici n'est PAS bénin : il signifie qu'on ne regarde pas la surface
  // qu'on prétend garder. La levée remonte à l'appelant, qui la nomme.
  const entries = await readdir(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      yield* walk(full)
    } else if (SCANNED_EXT.test(entry.name)) yield full
  }
}

const violations = []
const blind = []
let scanned = 0

for (const dir of SCAN_DIRS) {
  const abs = join(SRC, dir)
  let filesHere = 0
  try {
    for await (const file of walk(abs)) {
      filesHere += 1
      scanned += 1
      const rel = relative(SRC, file).split('\\').join('/')
      if (ALLOWLIST.has(rel)) continue

      const source = await readFile(file, 'utf8')
      for (const { re, what } of PLOT_MARKERS) {
        re.lastIndex = 0
        const hits = source.match(re)
        if (hits) violations.push({ rel, what, count: hits.length })
      }
    }
  } catch (err) {
    blind.push(`src/${dir} — illisible (${err.code || err.message})`)
    continue
  }
  if (filesHere === 0) blind.push(`src/${dir} — 0 fichier scanné (dossier vide ou déplacé)`)
}

// Une dispense doit désigner un fichier qui EXISTE. Une entrée périmée est un
// trou muet : le fichier surveillé a été renommé et la gate ne le sait pas.
for (const rel of ALLOWLIST.keys()) {
  try {
    await access(join(SRC, rel))
  } catch {
    blind.push(`ALLOWLIST src/${rel} — fichier absent, dispense périmée`)
  }
}

if (blind.length > 0) {
  console.error('✗ Chart guard AVEUGLE — il ne mesure pas ce qu\'il prétend garder.\n')
  for (const b of blind) console.error(`  ${b}`)
  console.error('\n  Une gate qui indexe 0 élément doit ÉCHOUER, jamais passer en silence :')
  console.error('  verte et aveugle, elle laisserait un moteur de graphique maison revenir.')
  console.error('  → corrige SCAN_DIRS / ALLOWLIST, ou lance la gate depuis la racine du repo.')
  process.exit(1)
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

// Le compte est affiché exprès : c'est la preuve que la gate a REGARDÉ. Une
// ligne « ✓ » sans volume mesuré ne prouve rien.
console.log('✓ Chart guard passed — aucun moteur de graphique maison ; les tracés passent par Recharts.')
console.log(`  ${scanned} fichier(s) scanné(s) sur ${SCAN_DIRS.length} surface(s), ${ALLOWLIST.size} dispense(s) vérifiée(s).`)
