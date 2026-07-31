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
    rel: file.replaceAll('\\', '/'),
    content: fs.readFileSync(file, 'utf8'),
  }))
}

function isReferenced(componentFile, corpus) {
  const rel = componentFile.replaceAll('\\', '/')
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

/**
 * Portée honnête de cette gate.
 *
 * Elle juge les composants de `src/components/`. Depuis le reset frontend ce
 * répertoire N'EXISTE PAS (AGENTS.md § Frontend, tenu par `check:no-legacy-front`
 * qui interdit justement son retour). Une gate sans cible ne doit pas afficher un
 * ✓ de succès : elle le DIT, explicitement, et sort 0 — l'absence de front est une
 * décision, pas une anomalie.
 *
 * Quand un nouveau front arrivera, cette gate se réarmera d'elle-même sur ses
 * fichiers, sans qu'on ait à la modifier. Le seul geste à prévoir alors : décider
 * si un répertoire de kit doit être exclu (une exportation inutilisée dans un kit
 * est de l'inventaire, pas du code produit mort).
 */
const COMPONENTS_DIR = 'src/components'

if (!fs.existsSync(COMPONENTS_DIR)) {
  console.log('◦ audit:dead — 0 cible : frontend volontairement absent.')
  console.log(`  \`${COMPONENTS_DIR}/\` n'existe pas (reset frontend, cf. AGENTS.md).`)
  console.log("  Aucun audit de composants n'a été réalisé — cette gate ne mesure rien aujourd'hui.")
  console.log('  Le code mort du reste du repo est couvert par knip (`npm run quality:dead`).')
  process.exit(0)
}

/**
 * Le kit Catalyst est une BIBLIOTHÈQUE vendorée, pas du code de page.
 *
 * Il est copié en entier depuis Tailwind Plus pour rester alignable sur l'amont.
 * À un instant donné, l'écran n'en consomme qu'une poignée de composants — les
 * autres sont de l'INVENTAIRE, pas du code mort. Les signaler ferait exactement
 * l'inverse de ce que cette gate protège : elle pousserait à supprimer ce sur
 * quoi la reconstruction du front est censée s'appuyer.
 *
 * La gate garde son vrai travail : repérer un composant PRODUIT que plus rien ne
 * rend. Ce qui est écrit ici pour Aigent reste jugé.
 */
const KIT_DIR = 'src/components/ui/'

const componentFiles = walk(COMPONENTS_DIR)
  .filter((f) => /\.(tsx|ts)$/.test(f))
  .filter((f) => !f.replaceAll('\\', '/').startsWith(KIT_DIR))
const corpus = loadCorpus()
const deadComponents = componentFiles.filter((f) => !isReferenced(f, corpus)).map((f) => f.replaceAll('\\', '/'))

if (deadComponents.length > 0) {
  console.error(`✗ ${deadComponents.length} dead component(s):\n`)
  for (const f of deadComponents.sort((a, b) => a.localeCompare(b))) console.error('  ' + f)
  process.exit(1)
}

console.log(`✓ No dead components (${componentFiles.length} checked).`)
