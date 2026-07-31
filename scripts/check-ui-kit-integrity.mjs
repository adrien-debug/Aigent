#!/usr/bin/env node
/**
 * Gate d'intégrité du kit de primitives `src/components/ui/`.
 *
 * CE QU'ELLE VÉRIFIE — l'empreinte SHA-256 de chacun des 14 fichiers du kit.
 * Toute modification, ajout ou suppression fait échouer la gate.
 *
 * POURQUOI ELLE EXISTE — deux dérives silencieuses, le même jour :
 *  · une mission « migrer vers Catalyst » a réécrit 215 lignes du kit pour y
 *    porter la densité et les couleurs du produit : des noms d'origine sur un
 *    fork non déclaré ;
 *  · une mission « sortir de Catalyst » a supprimé 2438 lignes pour en écrire
 *    257 — `TouchTarget` vidé de sa cible tactile de 44 px, `Button` réduit à
 *    4 couleurs sur les 6 consommées. Les 15 gates sont restées vertes, le
 *    build aussi, les 2105 tests aussi (revert `5e2aa63`).
 * Dans les deux cas la substance du kit a bougé sans que rien ne le signale.
 * Cette gate rend le changement VISIBLE ; elle ne le juge pas.
 *
 * CE QU'ELLE NE GARANTIT PAS — que les écrans utilisent le kit, qu'ils ne le
 * combattent pas de l'extérieur (`className` agressifs, `!important`), ni que
 * les primitives FONCTIONNENT. Elle compare des octets, pas un rendu. Aucune
 * gate de ce repo ne mesure ce qui s'affiche : après avoir touché une primitive,
 * ouvrez un écran qui la consomme et regardez-le.
 *
 * MODIFIER LE KIT est légitime — c'est du code du repo, pas du vendor. Après une
 * modification assumée, régénérer les empreintes :
 *   node scripts/check-ui-kit-integrity.mjs --update
 * Le diff du manifeste rend alors le changement visible en revue.
 *
 * Voir `src/components/ui/README.md` pour l'inventaire et les usages.
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
  console.log(`✓ ui-kit-integrity — kit de primitives intact.`)
  console.log(`  ${Object.keys(actual).length} fichier(s) vérifié(s) par empreinte SHA-256.`)
  console.log(`  Ne garantit PAS que les écrans l'utilisent, ni que les primitives fonctionnent : cette gate compare des octets, pas un rendu.`)
  process.exit(0)
}

console.error('✗ ui-kit-integrity — le kit de primitives a été altéré.\n')
for (const name of modified) console.error(`  MODIFIÉ  ${KIT_DIR}/${name}`)
for (const name of added) console.error(`  AJOUTÉ   ${KIT_DIR}/${name}`)
for (const name of removed) console.error(`  SUPPRIMÉ ${KIT_DIR}/${name}`)
console.error(`
Modifier le kit est légitime et volontaire quand le besoin est sur la primitive elle-même.
Après modification assumée : node scripts/check-ui-kit-integrity.mjs --update`)
process.exit(1)
