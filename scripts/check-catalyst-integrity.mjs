#!/usr/bin/env node
/**
 * Gate d'intégrité du kit Catalyst.
 *
 * POURQUOI ELLE EXISTE — le 2026-07-31, une mission « migrer vers Catalyst » a
 * fini par réécrire 215 lignes de `src/components/ui/` pour y porter la densité
 * et les couleurs du produit. Le résultat portait des noms Catalyst mais n'était
 * plus Catalyst : un fork silencieux. Cette gate rend cette dérive impossible
 * sans qu'on la voie.
 *
 * CE QU'ELLE VÉRIFIE — l'empreinte SHA-256 de chaque fichier du kit vendoré.
 * Toute modification, ajout ou suppression fait échouer la gate.
 *
 * CE QU'ELLE NE GARANTIT PAS — que les écrans utilisent réellement Catalyst,
 * ni qu'ils ne le combattent pas depuis l'extérieur (`className` agressifs,
 * `!important`). Elle protège le kit, pas son usage.
 *
 * SI VOUS DEVEZ VRAIMENT TOUCHER AU KIT — ce n'est pas un geste de mission de
 * code. Il faut une décision explicite d'Adrien, puis régénérer les empreintes :
 *   node scripts/check-catalyst-integrity.mjs --update
 * Le diff des empreintes rend alors le changement visible en revue.
 */
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const KIT_DIR = 'src/components/ui'
const MANIFEST = 'scripts/catalyst-kit.sha256.json'

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
  console.error('  Générez-le avec : node scripts/check-catalyst-integrity.mjs --update')
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
  console.log(`✓ Catalyst-integrity gate passed — kit officiel intact.`)
  console.log(`  ${Object.keys(actual).length} fichier(s) vérifié(s) par empreinte SHA-256.`)
  console.log(`  Ne garantit PAS que les écrans utilisent Catalyst, seulement que le kit n'a pas été forké.`)
  process.exit(0)
}

console.error('✗ Catalyst-integrity gate FAILED — le kit officiel a été altéré.\n')
for (const name of modified) console.error(`  MODIFIÉ  ${KIT_DIR}/${name}`)
for (const name of added) console.error(`  AJOUTÉ   ${KIT_DIR}/${name}`)
for (const name of removed) console.error(`  SUPPRIMÉ ${KIT_DIR}/${name}`)
console.error(`
Le kit Catalyst ne se modifie pas pour adapter un écran. Adaptez la COMPOSITION
côté écran, ou remontez le besoin à Adrien.

Si la modification est délibérée et validée : node scripts/check-catalyst-integrity.mjs --update`)
process.exit(1)
