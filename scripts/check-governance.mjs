#!/usr/bin/env node
// check-governance.mjs — la doctrine est ORGANISÉE, pas contradictoire.
//
// CE QUE CETTE GATE FAIT. Elle vérifie que les cinq fichiers canoniques existent,
// que chacun reste dans son périmètre, que la checklist fonctionnelle porte ses
// sections obligatoires, et qu'aucun document d'archive n'est cité comme règle
// active.
//
// CE QU'ELLE NE FAIT PAS, DÉLIBÉRÉMENT. Elle ne connaît aucune couleur, aucun
// jeton, aucune police, aucune grille, aucun layout. Figer une palette dans une
// gate transformerait une direction de design en prison et empêcherait toute
// évolution légitime — c'est écrit dans DESIGN_DOCTRINE.md §11 et c'est tenu ici.
// Elle vérifie l'ARCHITECTURE DE LA DOCTRINE, pas les décisions de design.
//
// POURQUOI ELLE EXISTE. Le mode de défaillance récurrent de ce repository n'est
// pas l'absence de règles, c'est leur DUPLICATION : la même règle écrite dans
// deux fichiers, qui divergent, puis se contredisent, et on ne sait plus laquelle
// gouverne. Cette gate rend cette duplication détectable mécaniquement.
//
// ANTI-VACUITÉ. Elle échoue si elle n'a rien pu lire. Un ✓ sur zéro cible est un
// mensonge, et ce repository en a déjà produit.

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = process.cwd()
const violations = []
let filesScanned = 0
let checksRun = 0

function read(rel) {
  const p = join(ROOT, rel)
  if (!existsSync(p)) return null
  filesScanned += 1
  return readFileSync(p, 'utf8')
}

/** Lignes d'un texte, 1-indexées, hors blocs de citation d'en-tête. */
function lines(text) {
  return text.split('\n').map((content, i) => ({ n: i + 1, content }))
}

function violation(file, line, rule, detail) {
  violations.push({ file, line, rule, detail })
}

// ---------------------------------------------------------------------------
// 1. Les cinq fichiers canoniques existent et disent quelque chose
// ---------------------------------------------------------------------------

const CANONICAL = [
  { path: 'PRODUCT_DOCTRINE.md', minLines: 40, role: 'doctrine produit' },
  { path: 'DESIGN_DOCTRINE.md', minLines: 40, role: 'doctrine design' },
  { path: 'AGENTS.md', minLines: 40, role: 'invariants techniques' },
  { path: 'CLAUDE.md', minLines: 40, role: "méthode d'exécution" },
  { path: 'docs/CURRENT_FUNCTIONAL_CHECKLIST.md', minLines: 30, role: 'état réel' },
]

const docs = {}
for (const { path, minLines, role } of CANONICAL) {
  checksRun += 1
  const text = read(path)
  if (text === null) {
    violation(path, 0, 'fichier-canonique-absent', `${role} — fichier introuvable`)
    continue
  }
  docs[path] = text
  const count = text.split('\n').length
  if (count < minLines) {
    violation(path, 0, 'fichier-canonique-vide', `${count} lignes, minimum ${minLines} (${role})`)
  }
}

// ---------------------------------------------------------------------------
// 2. Aucune règle « free design » ne gouverne la production
// ---------------------------------------------------------------------------
//
// On cherche les formulations qui AFFRANCHISSENT la production de toute règle
// visuelle. Une ligne qui INTERDIT le free design, ou qui l'autorise
// explicitement dans une zone d'exploration nommée, est légitime et exemptée.

const FREE_DESIGN = [
  /\bfree\s*design\b/i,
  /front\s+est\s+libre/i,
  /design\s+est\s+libre/i,
  /aucune?\s+r[èe]gle\s+de\s+ce\s+repository\s+n'impose/i,
  /aucun\s+layout,?\s+aucune\s+typographie/i,
  /n'?est\s+impos[ée]e?\s+(sur|aux)\s+(les\s+)?surfaces/i,
]

/** Une ligne est exemptée si elle nie la liberté, ou la borne à l'exploration. */
const FREE_DESIGN_EXEMPT = [
  /\bpas\s+de\b/i,
  /\baucune?\s+exploration\b/i,
  /\binterdit/i,
  /\bremplace\b/i,
  /\bne\s+gouverne\s+plus\b/i,
  /composer\s*\/\s*lab|lab\s*\/\s*prototype|zones?\s+d'exploration/i,
]

for (const path of ['PRODUCT_DOCTRINE.md', 'DESIGN_DOCTRINE.md', 'AGENTS.md', 'CLAUDE.md', 'README.md']) {
  const text = docs[path] ?? read(path)
  if (!text) continue
  checksRun += 1
  for (const { n, content } of lines(text)) {
    if (!FREE_DESIGN.some((re) => re.test(content))) continue
    if (FREE_DESIGN_EXEMPT.some((re) => re.test(content))) continue
    violation(path, n, 'free-design-en-production', content.trim().slice(0, 100))
  }
}

// ---------------------------------------------------------------------------
// 3. AGENTS.md ne contient aucun workflow git
// ---------------------------------------------------------------------------

const GIT_WORKFLOW = [
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|stash|cherry-pick|worktree|tag|fetch)\b/i,
  /\bstaging\s+nomm[ée]\b/i,
  /branche\s+`?mission\//i,
  /une\s+PR\s+par\s+mission/i,
  /ouvre[rz]?\s+une\s+PR/i,
]

if (docs['AGENTS.md']) {
  checksRun += 1
  for (const { n, content } of lines(docs['AGENTS.md'])) {
    if (GIT_WORKFLOW.some((re) => re.test(content))) {
      violation('AGENTS.md', n, 'git-dans-agents', content.trim().slice(0, 100))
    }
  }
}

// ---------------------------------------------------------------------------
// 4. CLAUDE.md ne contient aucune doctrine produit
// ---------------------------------------------------------------------------
//
// Un RENVOI vers PRODUCT_DOCTRINE.md est légitime — c'est même ce qu'on veut.
// Ce qu'on refuse, c'est la RÈGLE produit récrite sur place.

const PRODUCT_DOCTRINE_MARKERS = [
  /\bcontrol\s*plane\b/i,
  /\bruntime\s+gouvern[ée]\b/i,
  /create\s*(→|->)\s*qualify/i,
  /\bmarketplace\b/i,
  /produits?\s+consommateurs?\s+(ex[ée]cutent|appellent)/i,
  /\bplan\s+de\s+contr[ôo]le\b/i,
]

if (docs['CLAUDE.md']) {
  checksRun += 1
  for (const { n, content } of lines(docs['CLAUDE.md'])) {
    if (!PRODUCT_DOCTRINE_MARKERS.some((re) => re.test(content))) continue
    // Exempté : une ligne qui RENVOIE vers le fichier propriétaire.
    if (/PRODUCT_DOCTRINE\.md/.test(content)) continue
    violation('CLAUDE.md', n, 'doctrine-produit-dans-claude', content.trim().slice(0, 100))
  }
}

// ---------------------------------------------------------------------------
// 5. La checklist porte ses sections obligatoires
// ---------------------------------------------------------------------------

const REQUIRED_SECTIONS = [
  'Fonctionnel',
  'Testé',
  'Mergé',
  'Déployé',
  'Non fonctionnel',
  'Limites connues',
  'Prochaines étapes',
  'Preuves',
]

const checklist = docs['docs/CURRENT_FUNCTIONAL_CHECKLIST.md']
if (checklist) {
  checksRun += 1
  const headings = lines(checklist)
    .filter(({ content }) => /^#{1,3}\s/.test(content))
    .map(({ content }) => content.replace(/^#{1,3}\s+/, '').trim())

  for (const section of REQUIRED_SECTIONS) {
    // « Non fonctionnel » ne doit pas être satisfait par « Fonctionnel ».
    const found = headings.some((h) => h.localeCompare(section, 'fr', { sensitivity: 'base' }) === 0)
    if (!found) {
      violation(
        'docs/CURRENT_FUNCTIONAL_CHECKLIST.md',
        0,
        'section-obligatoire-absente',
        `section « ${section} » manquante`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// 6. Aucun document d'archive n'est présenté comme autorité active
// ---------------------------------------------------------------------------
//
// Un doc d'archive porte un bandeau ARCHIVE. Un fichier de règles ne doit pas
// le citer : le citer, c'est le réactiver sans le dire.

const ARCHIVE_BANNER = /^>\s*\*{0,2}\s*(ARCHIVE|archiv[ée])/im

const archived = []
const docsDir = join(ROOT, 'docs')
if (existsSync(docsDir)) {
  checksRun += 1
  for (const name of readdirSync(docsDir)) {
    if (!name.endsWith('.md')) continue
    const text = readFileSync(join(docsDir, name), 'utf8')
    filesScanned += 1
    // Bandeau cherché dans les 15 premières lignes : une mention d'archive
    // enfouie au milieu d'un document ne signale rien à un lecteur pressé.
    const head = text.split('\n').slice(0, 15).join('\n')
    if (ARCHIVE_BANNER.test(head)) archived.push(`docs/${name}`)
  }
}

const RULE_FILES = ['PRODUCT_DOCTRINE.md', 'DESIGN_DOCTRINE.md', 'AGENTS.md', 'CLAUDE.md']
for (const rulePath of RULE_FILES) {
  const text = docs[rulePath]
  if (!text) continue
  for (const { n, content } of lines(text)) {
    for (const arch of archived) {
      if (!content.includes(arch)) continue
      // Exempté si la ligne dit explicitement que c'est une archive.
      if (/archive/i.test(content)) continue
      violation(rulePath, n, 'archive-citée-comme-règle', `${arch} cité sans mention d'archive`)
    }
  }
}

// ---------------------------------------------------------------------------
// Anti-vacuité + rapport
// ---------------------------------------------------------------------------

if (filesScanned === 0 || checksRun === 0) {
  console.error('✗ check:governance — AUCUNE cible lue. Cette gate n\'a rien mesuré.')
  process.exit(1)
}

if (violations.length > 0) {
  console.error(`✗ check:governance — ${violations.length} violation(s)\n`)
  const byRule = new Map()
  for (const v of violations) {
    if (!byRule.has(v.rule)) byRule.set(v.rule, [])
    byRule.get(v.rule).push(v)
  }
  for (const [rule, items] of byRule) {
    console.error(`  ${rule}`)
    for (const v of items) {
      console.error(`    ${v.file}${v.line ? `:${v.line}` : ''} — ${v.detail}`)
    }
    console.error('')
  }
  process.exit(1)
}

console.log(
  `✓ check:governance — ${CANONICAL.length} fichier(s) canonique(s), ` +
    `${REQUIRED_SECTIONS.length} section(s) de checklist, ` +
    `${archived.length} document(s) d'archive, ` +
    `${filesScanned} fichier(s) lu(s), ${checksRun} contrôle(s).`,
)
console.log(
  '  Ne garantit PAS : la justesse du design, la véracité de la checklist, ' +
    'ni qu\'une règle écrite soit appliquée dans le code.',
)
