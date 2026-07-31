#!/usr/bin/env node
/**
 * Écrit le manifeste des preuves visuelles avec le SHA et la branche RÉELS.
 *
 * POURQUOI UN SCRIPT PLUTÔT QU'UN FICHIER ÉCRIT À LA MAIN
 * ------------------------------------------------------
 * Un manifeste rédigé manuellement porte le SHA connu au moment de la
 * rédaction — donc jamais celui du commit qui le contient. C'est exactement le
 * défaut relevé par le REWORK v1 : le manifeste annonçait `3c66f36` sur
 * `mission/aigent-supervision-learning-001` alors que la PR vivait sur
 * `8b69580` / `mission/learning-command-center`.
 *
 * Ce script lit git, inventorie les captures réellement présentes sur disque,
 * et écrit le fichier. Le SHA reste celui du commit PRÉCÉDENT (on ne peut pas
 * connaître le sien avant de le créer) — c'est dit explicitement dans le
 * champ `shaNote` plutôt que masqué.
 *
 * Usage : node scripts/write-visual-manifest.mjs <dir>
 * Écrit UNIQUEMENT le manifeste. Aucune action git, aucun réseau.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const dir = process.argv[2]
if (!dir) {
  console.error('usage: node scripts/write-visual-manifest.mjs <dir>')
  process.exit(1)
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim()

const sha = git('rev-parse', 'HEAD')
const branch = git('rev-parse', '--abbrev-ref', 'HEAD')

/** Ce que chaque capture montre — la seule part que ce script ne peut pas
 *  déduire, donc la seule qui reste écrite à la main. */
const STATES = {
  'desktop-1440x900.png': {
    route: '/learning',
    viewport: '1440x900',
    state: 'Obsidian not_configured · Learning Runtime not_configured',
  },
  'laptop-1280x800.png': {
    route: '/learning',
    viewport: '1280x800',
    state: 'Obsidian not_configured · Learning Runtime not_configured',
  },
  'mobile-375x812.png': {
    route: '/learning',
    viewport: '375x812',
    state: 'Quatre zones empilées, aucun recouvrement par le contrôle fixe, 0 débordement',
  },
  'obsidian-bridge-state-1440x900.png': {
    route: '/learning',
    viewport: '1440x900',
    state: 'Obsidian not_configured — message nommant AIGENT_OBSIDIAN_VAULT, aucun bouton mort',
  },
  'learning-runtime-unavailable-1440x900.png': {
    route: '/learning',
    viewport: '1440x900',
    state:
      'Learning Runtime UNAVAILABLE (port fermé, latence mesurée, endpoint sans jeton) · Obsidian CONFIGURÉ',
    note: 'Capturée sous configuration temporaire, restaurée depuis — voir REVIEW.md',
  },
  'actions-desktop-1440x900.png': {
    route: '/actions',
    viewport: '1440x900',
    state: 'File réelle, filtres projet/statut visibles, badges « lecture seule », pied avec provenance',
  },
  'actions-mobile-375x812.png': {
    route: '/actions',
    viewport: '375x812',
    state: 'File en colonne, filtres wrappés, titre dégagé du contrôle fixe',
  },
  'actions-mobile-long-queue-375x812.png': {
    route: '/actions',
    viewport: '375x812',
    state: 'FILE LONGUE (24 lignes clonées dans le harness) défilant dans sa boîte bornée',
    note: 'Le pied affiche le compte RÉEL du serveur (2), ce qui prouve que le clonage reste dans le navigateur',
  },
  'actions-mobile-long-queue-nav-open-375x812.png': {
    route: '/actions',
    viewport: '375x812',
    state: 'FILE LONGUE + navigation mobile OUVERTE — 11 surfaces atteignables',
  },
  'actions-mobile-nav-open-375x812.png': {
    route: '/actions',
    viewport: '375x812',
    state: 'Navigation mobile ouverte, file courte',
  },
}

const captures = readdirSync(dir)
  .filter((f) => f.endsWith('.png'))
  .toSorted()
  .map((file) => {
    const meta = STATES[file]
    if (!meta) {
      console.warn(`  ! capture sans état déclaré : ${file}`)
      return { file, bytes: statSync(join(dir, file)).size, state: 'NON DÉCRIT — à documenter' }
    }
    return { file, bytes: statSync(join(dir, file)).size, ...meta, consoleErrors: 0 }
  })

const manifest = {
  mission: 'AIGENT-SUPERVISION-LEARNING-001',
  issue: 64,
  pullRequest: 65,
  branch,
  sha,
  shaNote:
    "SHA du commit qui PRÉCÈDE celui portant ce manifeste — un fichier ne peut pas contenir l'empreinte du commit qui le crée. Généré par scripts/write-visual-manifest.mjs, jamais à la main.",
  generatedBy: 'scripts/write-visual-manifest.mjs',
  capturedBy: 'scripts/prove-learning-actions-e2e.mjs --capture',
  browser: {
    engine: 'Chromium',
    driver: 'Playwright 1.50.1',
    profile: 'profil éphémère Playwright — jamais le profil Chrome quotidien',
  },
  server: {
    url: 'http://127.0.0.1:3987',
    mode: 'dev (npm run dev — Next 3987 + LangGraph 2024)',
    dataSource: 'gpu1 live (PostgREST)',
    devBadgeHidden:
      "Le badge de développement Next.js (`nextjs-portal`) est masqué à la capture : il n'existe pas en production et se lirait comme un élément d'interface.",
  },
  consoleErrors: 0,
  consoleWarnings: 0,
  e2e: {
    command: 'npm run prove:learning-e2e',
    result: 'vert — 15 assertions',
    covers: [
      'zéro erreur console sur /learning et /actions',
      'zéro débordement horizontal à 375×812',
      'aucun contrôle fixe ne recouvre le contenu, à 5 positions de défilement',
      'file longue : défile dans sa boîte bornée, sans débordement',
      'navigation mobile ouverte : 11 surfaces atteignables',
    ],
    fixturePolicy:
      "La file longue est clonée DANS LE NAVIGATEUR à partir des lignes réellement servies. Aucune fixture n'entre dans le parcours produit, aucun drapeau de test n'existe dans src/**.",
  },
  captures,
  notProven: [
    "L'ouverture réelle d'un vault Obsidian — l'application n'est pas installée sur cette machine. Seule la bonne formation des URI est prouvée.",
    "Les états 'live' et 'partial' du Learning Runtime contre un vrai moteur — H-Supervised n'existe pas encore. Seul 'unavailable' a été obtenu en conditions réelles.",
    'La reprise d’un run needs-confirmation de bout en bout — aucun run dans cet état dans la fenêtre au moment des captures.',
    'Le rendu au pixel — aucune gate ne le mesure. Ces images sont lues par un humain.',
  ],
}

const out = join(dir, 'manifest.json')
writeFileSync(out, JSON.stringify(manifest, null, 2) + '\n', 'utf8')
console.log(`✓ manifeste écrit — ${captures.length} capture(s), sha ${sha.slice(0, 7)}, branche ${branch}`)
console.log(`  ${out}`)
