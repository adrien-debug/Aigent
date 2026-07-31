#!/usr/bin/env node
/**
 * Gate d'intégrité du kit UI (`src/components/ui/`).
 *
 * HISTORIQUE — jusqu'au 2026-07-31 ce kit était un fork vendoré de Catalyst
 * (Tailwind UI). Décision explicite d'Adrien le 2026-07-31 : le kit est
 * réécrit en composants custom minimalistes, propriété du repo, sans
 * dépendance à un design system tiers. Cette gate ne protège donc plus « un
 * vendor intact » mais empêche une dérive silencieuse : que le kit gonfle à
 * nouveau de variantes non utilisées ou soit modifié à la volée pour un seul
 * écran, sans que ça se voie en revue.
 *
 * CE QU'ELLE VÉRIFIE — l'empreinte SHA-256 de chaque fichier du kit. Toute
 * modification, ajout ou suppression fait échouer la gate.
 *
 * CE QU'ELLE NE GARANTIT PAS — que les écrans utilisent réellement le kit, ni
 * qu'ils ne le contournent pas depuis l'extérieur (`className` agressifs,
 * `!important`). Elle protège le kit, pas son usage.
 *
 * SI VOUS DEVEZ TOUCHER AU KIT — ce n'est pas un geste anodin de mission de
 * code : le kit est partagé par tous les écrans produit. Une fois le
 * changement voulu et relu, régénérez les empreintes :
 *   node scripts/check-ui-kit-integrity.mjs --update
 * Le diff des empreintes rend alors le changement visible en revue.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KIT_DIR = 'src/components/ui'
const MANIFEST = 'scripts/ui-kit.sha256.json'

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function currentKit() {
  const files = readdirSync(KIT_DIR)
    .filter((name) => name.endsWith('.tsx') || name.endsWith('.ts'))
    .sort()
  return Object.fromEntries(files.map((name) => [name, sha256(join(KIT_DIR, name))]))
}

const actual = currentKit()

if (process.argv.includes('--update')) {
  writeFileSync(MANIFEST, `${JSON.stringify(actual, null, 2)}\n`)
  console.log(`✓ Empreintes du kit régénérées — ${Object.keys(actual).length} fichier(s).`)
  console.log('  Le diff de ce fichier doit être relu en revue : il prouve une modification du kit.')
  process.exit(0)
}

let expected
try {
  expected = JSON.parse(readFileSync(MANIFEST, 'utf8'))
} catch {
  console.error(`✗ Manifeste introuvable ou illisible : ${MANIFEST}`)
  console.error('  Générez-le avec : node scripts/check-ui-kit-integrity.mjs --update')
  process.exit(1)
}

const modified = []
const added = []
const removed = []

for (const [name, hash] of Object.entries(actual)) {
  if (!(name in expected)) added.push(name)
  else if (expected[name] !== hash) modified.push(name)
}
for (const name of Object.keys(expected)) {
  if (!(name in actual)) removed.push(name)
}

if (modified.length === 0 && added.length === 0 && removed.length === 0) {
  console.log(`✓ UI-kit-integrity gate passed — kit intact.`)
  console.log(`  ${Object.keys(actual).length} fichier(s) vérifié(s) par empreinte SHA-256.`)
  console.log(`  Ne garantit PAS que les écrans utilisent le kit, seulement qu'il n'a pas été forké silencieusement.`)
  process.exit(0)
}

console.error('✗ UI-kit-integrity gate FAILED — le kit a été modifié.\n')
for (const name of modified) console.error(`  MODIFIÉ  ${KIT_DIR}/${name}`)
for (const name of added) console.error(`  AJOUTÉ   ${KIT_DIR}/${name}`)
for (const name of removed) console.error(`  SUPPRIMÉ ${KIT_DIR}/${name}`)
console.error(`
Si la modification est délibérée et validée : node scripts/check-ui-kit-integrity.mjs --update`)
process.exit(1)
