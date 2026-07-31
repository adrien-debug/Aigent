#!/usr/bin/env node
/**
 * Schema-rebuildable guard — le repo doit pouvoir reconstruire son propre schéma.
 *
 * POURQUOI CETTE GATE EXISTE
 * --------------------------
 * Le 2026-07-31, la reconstruction de `aigent_qa` depuis une base vide a échoué
 * sur `0042_agent_drafts.sql` : `relation "agent_drafts" does not exist`. La
 * table avait été créée À LA MAIN sur la production, et `0042` ne faisait qu'un
 * `grant` en l'assumant — son propre commentaire le disait : « la table existe
 * DÉJÀ sur gpu1 … elle ne recrée rien ».
 *
 * Aucune gate ne pouvait le voir. Toutes s'exécutent contre une base qui
 * portait déjà la table ; le défaut n'apparaît qu'en repartant de zéro. Un
 * schéma dont une partie n'existe que sur un serveur est un schéma qu'on ne
 * peut ni reconstruire, ni auditer, ni migrer ailleurs — et personne ne s'en
 * aperçoit tant que ce serveur vit.
 *
 * CE QUE CETTE GATE VÉRIFIE — statiquement, sans base ni réseau
 * ------------------------------------------------------------
 * Toute table RÉFÉRENCÉE par une migration (grant, alter, index, policy, FK)
 * doit être CRÉÉE par une migration antérieure ou par elle-même. Une référence
 * sans création est exactement le motif qui a produit le défaut : la migration
 * suppose un état du serveur au lieu de le construire.
 *
 * CE QU'ELLE NE GARANTIT PAS — à lire avant de s'y fier
 * ----------------------------------------------------
 * · Elle ne rejoue rien. Une migration syntaxiquement valide mais fausse au
 *   runtime (mauvais type, contrainte impossible) passe ici. La seule preuve
 *   d'une reconstruction est une reconstruction — celle de `aigent_qa`.
 * · Elle ne voit pas les COLONNES ajoutées à la main : `alter table x add
 *   column if not exists` ne trahit rien, et une colonne créée hors migration
 *   sur la production reste invisible d'ici.
 * · Elle ne compare rien à la production. Une migration peut créer une table
 *   au schéma DIVERGENT de celle qui tourne : la gate la voit « créée », pas
 *   « conforme ».
 *
 * Exit 0 = clean, exit 1 = violation. Lecture seule, hors ligne, sans secret.
 */
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MIGRATIONS = join(ROOT, 'supabase/migrations')

/**
 * Tables que le repo ne crée pas et n'a pas à créer : elles appartiennent à
 * PostgreSQL ou à une extension. Une référence à l'une d'elles n'est pas une
 * dette de migration.
 */
const FOREIGN_TABLES = new Set([
  'pg_catalog', 'information_schema', 'pg_class', 'pg_index', 'pg_constraint',
  'pg_policies', 'pg_tables', 'pg_roles', 'pg_database', 'pg_extension',
])

/** `create table [if not exists] <nom>` — ce qui CONSTRUIT le schéma. */
const CREATE_RE = /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi

/**
 * Les formes qui SUPPOSENT une table déjà présente. `grant` est celle qui a
 * masqué le défaut d'origine — elle réussit sur un serveur qui a la table et
 * échoue partout ailleurs.
 */
const REFERENCE_PATTERNS = [
  // `grant … on [table] <nom>` — mais PAS `grant … on function|schema|sequence|
  // database|all tables in schema …`, qui ne nomment aucune table. Sans cette
  // exclusion la gate capture les mots-clés eux-mêmes (`all`, `function`) et
  // produit des faux positifs qui la rendraient inutilisable — constaté au
  // premier sondage.
  { kind: 'grant', re: /grant\s+[^;]*?\s+on\s+(?!function\b|schema\b|sequence\b|database\b|all\b|procedure\b|routine\b|type\b|domain\b|language\b|foreign\b|large\b|tablespace\b)(?:table\s+)?(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi },
  { kind: 'alter', re: /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi },
  { kind: 'index', re: /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?[a-z0-9_]+\s+on\s+(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi },
  { kind: 'policy', re: /create\s+policy\s+[^;]*?\s+on\s+(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi },
  { kind: 'comment', re: /comment\s+on\s+(?:table|column)\s+(?:public\.)?["']?([a-z_][a-z0-9_]*)["']?/gi },
]

/** Retire commentaires et littéraux : un nom de table cité en prose n'est pas une référence. */
function strip(sql) {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
}

function collect(re, text) {
  const out = []
  re.lastIndex = 0
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1].toLowerCase())
  return out
}

const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort()
if (files.length === 0) {
  console.error('✗ Schema-rebuildable guard FAILED — aucune migration trouvée.')
  console.error('  Une gate qui n\'a rien mesuré ne doit jamais sortir 0 en silence.')
  process.exit(1)
}

const created = new Set()
const violations = []

for (const file of files) {
  const raw = await readFile(join(MIGRATIONS, file), 'utf8')
  const sql = strip(raw)

  // Les créations de CE fichier comptent pour lui-même : une migration peut
  // créer une table puis la granter dans la foulée.
  for (const t of collect(CREATE_RE, sql)) created.add(t)

  for (const { kind, re } of REFERENCE_PATTERNS) {
    for (const table of collect(re, sql)) {
      if (created.has(table) || FOREIGN_TABLES.has(table)) continue
      violations.push({ file, kind, table })
    }
  }
}

if (violations.length > 0) {
  console.error(`✗ Schema-rebuildable guard FAILED — ${violations.length} référence(s) à une table qu'aucune migration ne crée :`)
  for (const v of violations) {
    console.error(`  ${v.file} — ${v.kind} sur \`${v.table}\``)
  }
  console.error('')
  console.error('  Une table référencée mais jamais créée signifie qu\'elle existe SUR UN SERVEUR')
  console.error('  et nulle part dans le repo. La suite ne peut plus être rejouée depuis zéro —')
  console.error('  c\'est exactement le défaut trouvé sur `agent_drafts` le 2026-07-31.')
  console.error('  Correctif : écrire la migration de création, depuis le schéma RÉEL relevé en')
  console.error('  lecture seule, numérotée avant sa première référence, et idempotente.')
  process.exit(1)
}

console.log('✓ Schema-rebuildable guard passed — toute table référencée est créée par une migration.')
console.log(`  ${files.length} migration(s) analysée(s), ${created.size} table(s) créée(s).`)
console.log('  Ne garantit PAS que la suite s\'applique réellement : seule une reconstruction le prouve.')
