#!/usr/bin/env node
/**
 * Validation STRUCTURELLE du vault Obsidian — AIGENT-VISUAL-STACK-002.
 *
 * « Le fichier existe » ne prouve rien. Un `.canvas` dont une arête pointe vers
 * un nœud inexistant s'ouvre dans Obsidian en paraissant plausible, et le lien
 * manquant ne se voit pas. Ce script vérifie ce qui casserait réellement :
 *   - JSON parsable et schéma Canvas respecté ;
 *   - chaque arête référence deux nœuds QUI EXISTENT ;
 *   - chaque nœud `file` pointe vers un fichier présent ;
 *   - chaque `[[lien]]` interne résout vers une note réelle ;
 *   - le YAML frontmatter des notes est bien formé ;
 *   - aucun secret n'a fui dans le vault.
 *
 * Exit 0 si tout tient, 1 sinon. Aucune écriture.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, extname, basename } from 'node:path'

const VAULT = new URL('../vault/', import.meta.url).pathname
const problems = []
const stats = { notes: 0, canvases: 0, noeuds: 0, aretes: 0, liens: 0, bases: 0 }

/** Parcours récursif du vault, en ignorant l'état local d'Obsidian. */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    if (entry === '.obsidian') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = walk(VAULT)
const notes = files.filter((f) => extname(f) === '.md')
const canvases = files.filter((f) => extname(f) === '.canvas')
const bases = files.filter((f) => extname(f) === '.base')

stats.notes = notes.length
stats.canvases = canvases.length
stats.bases = bases.length

/** Index des noms de notes, pour résoudre les [[liens]]. */
const noteNames = new Set(notes.map((f) => basename(f, '.md')))

// ------------------------------------------------------------------ CANVASES
for (const canvasPath of canvases) {
  const rel = relative(VAULT, canvasPath)
  let canvas
  try {
    canvas = JSON.parse(readFileSync(canvasPath, 'utf8'))
  } catch (err) {
    problems.push(`${rel}: JSON invalide — ${err.message}`)
    continue
  }

  if (!Array.isArray(canvas.nodes)) {
    problems.push(`${rel}: 'nodes' absent ou non tableau`)
    continue
  }
  if (!Array.isArray(canvas.edges)) {
    problems.push(`${rel}: 'edges' absent ou non tableau`)
    continue
  }

  stats.noeuds += canvas.nodes.length
  stats.aretes += canvas.edges.length

  const ids = new Set()
  for (const node of canvas.nodes) {
    if (!node.id) problems.push(`${rel}: un nœud sans id`)
    if (ids.has(node.id)) problems.push(`${rel}: id de nœud dupliqué « ${node.id} »`)
    ids.add(node.id)

    for (const key of ['x', 'y', 'width', 'height']) {
      if (typeof node[key] !== 'number' && typeof node[key] !== 'string') {
        problems.push(`${rel}: nœud ${node.id} — '${key}' manquant`)
      }
    }

    // Un nœud `file` qui pointe dans le vide s'affiche vide, sans erreur.
    if (node.type === 'file') {
      if (!node.file) {
        problems.push(`${rel}: nœud fichier ${node.id} sans chemin`)
      } else if (!existsSync(join(VAULT, node.file))) {
        problems.push(`${rel}: nœud ${node.id} → fichier introuvable « ${node.file} »`)
      }
    }

    if (node.type === 'text' && !node.text) {
      problems.push(`${rel}: nœud texte ${node.id} vide`)
    }
  }

  // Le cœur : une arête orpheline est invisible à l'œil et casse le sens.
  const SIDES = new Set(['top', 'right', 'bottom', 'left'])
  for (const edge of canvas.edges) {
    if (!edge.id) problems.push(`${rel}: une arête sans id`)
    if (!ids.has(edge.fromNode)) {
      problems.push(`${rel}: arête ${edge.id} — source inexistante « ${edge.fromNode} »`)
    }
    if (!ids.has(edge.toNode)) {
      problems.push(`${rel}: arête ${edge.id} — cible inexistante « ${edge.toNode} »`)
    }
    for (const [key, val] of [['fromSide', edge.fromSide], ['toSide', edge.toSide]]) {
      if (val !== undefined && !SIDES.has(val)) {
        problems.push(`${rel}: arête ${edge.id} — '${key}' invalide « ${val} »`)
      }
    }
  }
}

// --------------------------------------------------------------------- NOTES
for (const notePath of notes) {
  const rel = relative(VAULT, notePath)
  const content = readFileSync(notePath, 'utf8')

  // Frontmatter : présent et fermé. Un `---` non refermé avale toute la note.
  if (content.startsWith('---')) {
    const end = content.indexOf('\n---', 3)
    if (end === -1) {
      problems.push(`${rel}: frontmatter non fermé`)
    } else {
      for (const line of content.slice(4, end).split('\n')) {
        if (line.trim() === '' || line.startsWith('#') || line.startsWith('  ')) continue
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*\s*:/.test(line)) {
          problems.push(`${rel}: ligne de frontmatter invalide — « ${line.trim().slice(0, 40)} »`)
        }
      }
    }
  }

  // Liens internes : un [[lien]] mort ne se voit qu'en cliquant dessus.
  for (const match of content.matchAll(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g)) {
    const target = match[1].trim()
    stats.liens += 1
    // Un template porte des liens d'exemple ; on ne les exige pas résolus.
    if (rel.startsWith('templates/')) continue
    if (!noteNames.has(target)) {
      problems.push(`${rel}: lien mort « [[${target}]] »`)
    }
  }
}

// --------------------------------------------------------------------- BASES
for (const basePath of bases) {
  const rel = relative(VAULT, basePath)
  const content = readFileSync(basePath, 'utf8')
  if (!content.includes('views:')) problems.push(`${rel}: aucune vue définie`)
  if (!content.includes('filters:')) problems.push(`${rel}: aucun filtre défini`)
}

// ------------------------------------------------------------------- SECRETS
// Un vault versionné qui porte une clé est une fuite permanente.
const SECRET_PATTERNS = [
  [/lsv2_pt_[a-f0-9]{32}/i, 'clé LangSmith'],
  [/sk-[a-zA-Z0-9]{32,}/, 'clé OpenAI'],
  [/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'JWT'],
  [/postgres(?:ql)?:\/\/[^\s"']*:[^\s"'@]+@/, 'URL Postgres avec mot de passe'],
]
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const [pattern, label] of SECRET_PATTERNS) {
    if (pattern.test(content)) {
      problems.push(`${relative(VAULT, file)}: ${label} détectée — NE PAS COMMITTER`)
    }
  }
}

// -------------------------------------------------------------------- RAPPORT
console.log('Vault Aigent — validation structurelle')
console.log(`  notes      : ${stats.notes}`)
console.log(`  canvases   : ${stats.canvases} (${stats.noeuds} nœuds, ${stats.aretes} arêtes)`)
console.log(`  bases      : ${stats.bases}`)
console.log(`  liens [[]] : ${stats.liens}`)

if (problems.length > 0) {
  console.log(`\n${problems.length} problème(s) :`)
  for (const p of problems) console.log(`  ✗ ${p}`)
  process.exit(1)
}

console.log('\n✓ Toutes les arêtes résolvent, tous les liens résolvent, aucun secret.')
process.exit(0)
