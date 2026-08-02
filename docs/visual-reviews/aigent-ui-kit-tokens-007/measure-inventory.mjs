// Inventaire exact des couleurs brutes du kit Catalyst.
// Compte par fichier ET par jeton, en distinguant ce qui est structurel
// (couleur de surface/texte/bordure) de ce qui ne l'est pas.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIR = 'src/components/ui'
const files = readdirSync(DIR)
  .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
  .sort()

// Tout jeton de couleur Tailwind brut : palette nommée OU white/black.
const TOKEN =
  /\b(?:bg|text|ring|border|fill|stroke|divide|outline|shadow|from|via|to|placeholder|decoration|accent|caret)-(?:(?:zinc|slate|gray|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)(?:\/\d{1,3})?\b/g

const perFile = {}
const perToken = {}
let total = 0

for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8')
  const hits = src.match(TOKEN) || []
  if (hits.length) perFile[f] = hits.length
  total += hits.length
  for (const h of hits) perToken[h] = (perToken[h] || 0) + 1
}

// Combien sont sous variante `dark:` (donc déjà conditionnels) ?
let darkScoped = 0
for (const f of files) {
  const src = readFileSync(join(DIR, f), 'utf8')
  for (const m of src.matchAll(/dark:([a-z-]+-(?:\w+-\d{2,3}|white|black)(?:\/\d{1,3})?)/g)) {
    if (m[1]) darkScoped++
  }
}

console.log('=== PAR FICHIER ===')
for (const [f, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1]))
  console.log(String(n).padStart(4), f)
console.log('\n=== PAR JETON (top 40) ===')
for (const [t, n] of Object.entries(perToken)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 40))
  console.log(String(n).padStart(4), t)
console.log('\nTOTAL occurrences   :', total)
console.log('dont sous `dark:`   :', darkScoped)
console.log('fichiers du kit     :', files.length)
console.log('fichiers concernes  :', Object.keys(perFile).length)
