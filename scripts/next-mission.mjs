#!/usr/bin/env node
/**
 * `/next` — point d'entrée opérateur : quelle est la prochaine mission ?
 *
 * CE QUE CETTE COMMANDE REFUSE DE FAIRE. Elle ne choisit jamais à ta place
 * quand le choix est ambigu, elle n'invente jamais de mission quand il n'y en a
 * pas, et elle ne touche ni à git ni à GitHub en écriture. Elle lit, elle
 * classe, elle affiche. Aucun merge, aucun déploiement, aucun `/squad`
 * implicite — ces gestes appartiennent à l'opérateur.
 *
 * Sélection : parmi les issues ouvertes portant un label d'orchestration,
 * `orchestrator:rework` l'emporte sur `orchestrator:ready` (une reprise est
 * plus urgente qu'un démarrage). À priorité égale, PLUSIEURS candidates →
 * ambiguïté déclarée, aucune sélection.
 *
 * États rendus : READY · REWORK · REVIEW · BLOCKED · NONE · AMBIGUOUS ·
 * UNAVAILABLE. Ils ne sont pas interchangeables : `UNAVAILABLE` (GitHub
 * injoignable) n'est pas `NONE` (aucune mission), et confondre les deux ferait
 * croire que le travail est terminé alors qu'on n'a rien pu lire.
 *
 * Usage :
 *   node scripts/next-mission.mjs           # rendu opérateur
 *   node scripts/next-mission.mjs --json    # sortie machine
 */
import { execFileSync } from 'node:child_process'

const JSON_OUT = process.argv.includes('--json')

/** Labels d'orchestration, du plus prioritaire au moins prioritaire. */
const PRIORITY = ['orchestrator:rework', 'orchestrator:ready']

/** Labels qui écartent une issue de la sélection, avec leur état rendu. */
const EXCLUDING = {
  'orchestrator:blocked': 'BLOCKED',
  'orchestrator:review': 'REVIEW',
}

function fail(state, reason, extra = {}) {
  emit({ state, reason, mission: null, ...extra })
  process.exit(state === 'UNAVAILABLE' ? 2 : 0)
}

function emit(payload) {
  if (JSON_OUT) {
    console.log(JSON.stringify(payload, null, 2))
    return
  }
  render(payload)
}

/** Exécute une commande en lecture seule. Retourne null au lieu de throw. */
function run(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  } catch {
    return null
  }
}

// ------------------------------------------------------- 1. DÉPÔT COURANT
const remote = run('git', ['remote', 'get-url', 'origin'])
if (!remote) {
  fail('UNAVAILABLE', "pas de remote 'origin' — cette commande doit tourner dans un dépôt git")
}

const repoMatch = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(remote)
if (!repoMatch) {
  fail('UNAVAILABLE', `remote non-GitHub : ${remote}`)
}
const repo = `${repoMatch[1]}/${repoMatch[2]}`
const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '(inconnue)'

// ------------------------------------------------------- 2. PRÉCONDITIONS
if (!run('gh', ['--version'])) {
  fail('UNAVAILABLE', "la CLI `gh` est absente — impossible de lire les missions", { repo })
}
if (run('gh', ['auth', 'status']) === null) {
  fail('UNAVAILABLE', 'CLI `gh` non authentifiée — lance `gh auth login`', { repo })
}

// -------------------------------------------------- 3. LECTURE DES ISSUES
const raw = run('gh', [
  'issue', 'list',
  '--repo', repo,
  '--state', 'open',
  '--limit', '100',
  '--json', 'number,title,labels,updatedAt,url',
])
if (raw === null) {
  fail('UNAVAILABLE', `GitHub injoignable ou dépôt illisible (${repo})`, { repo })
}

let issues
try {
  issues = JSON.parse(raw)
} catch {
  fail('UNAVAILABLE', 'réponse GitHub illisible', { repo })
}

const labelsOf = (issue) => (issue.labels ?? []).map((l) => l.name)

// ------------------------------------------------------- 4. CLASSEMENT
const excluded = []
const candidates = []

for (const issue of issues) {
  const labels = labelsOf(issue)

  const blockingLabel = Object.keys(EXCLUDING).find((l) => labels.includes(l))
  if (blockingLabel) {
    excluded.push({ ...issue, state: EXCLUDING[blockingLabel], labels })
    continue
  }

  const rank = PRIORITY.findIndex((l) => labels.includes(l))
  if (rank !== -1) {
    candidates.push({ ...issue, rank, labels, state: rank === 0 ? 'REWORK' : 'READY' })
  }
}

if (candidates.length === 0) {
  const state = excluded.length > 0 ? excluded[0].state : 'NONE'
  const reason =
    excluded.length > 0
      ? `aucune mission actionnable — ${excluded.length} issue(s) en attente (${excluded.map((e) => `#${e.number} ${e.state}`).join(', ')})`
      : 'aucune issue ne porte de label d’orchestration'
  fail(state, reason, { repo, branch, excluded: excluded.map(summarize) })
}

// Priorité la plus haute, puis détection d'ambiguïté à égalité.
const bestRank = Math.min(...candidates.map((c) => c.rank))
const top = candidates.filter((c) => c.rank === bestRank)

if (top.length > 1) {
  // JAMAIS de choix silencieux : deux missions de même priorité sont une
  // décision d'opérateur, pas une décision de script.
  fail(
    'AMBIGUOUS',
    `${top.length} missions de priorité identique (${PRIORITY[bestRank]}) — départage requis`,
    { repo, branch, candidates: top.map(summarize) }
  )
}

const mission = top[0]

// ------------------------------------------- 5. CONTEXTE CANONIQUE
const body = run('gh', ['issue', 'view', String(mission.number), '--repo', repo, '--json', 'body'])
let missionBody = null
if (body) {
  try {
    missionBody = JSON.parse(body).body ?? null
  } catch {
    missionBody = null
  }
}

// Dernier commentaire — c'est là que vit un rework.
const commentsRaw = run('gh', [
  'issue', 'view', String(mission.number), '--repo', repo, '--json', 'comments',
])
let lastComment = null
if (commentsRaw) {
  try {
    const list = JSON.parse(commentsRaw).comments ?? []
    const last = list[list.length - 1]
    if (last) {
      lastComment = {
        auteur: last.author?.login ?? '(inconnu)',
        date: last.createdAt ?? null,
        extrait: (last.body ?? '').slice(0, 400),
      }
    }
  } catch {
    lastComment = null
  }
}

// Branche et PR existantes — à RÉUTILISER, jamais à recréer en double.
const branchesRaw = run('git', ['branch', '-a', '--format=%(refname:short)']) ?? ''
const existingBranches = branchesRaw
  .split('\n')
  .map((b) => b.replace(/^origin\//, '').trim())
  .filter((b) => b.startsWith('mission/'))

const prRaw = run('gh', [
  'pr', 'list', '--repo', repo, '--state', 'open', '--limit', '50',
  '--json', 'number,title,headRefName,isDraft,url',
])
let linkedPr = null
if (prRaw) {
  try {
    const prs = JSON.parse(prRaw)
    linkedPr =
      prs.find((p) => (p.title ?? '').includes(`#${mission.number}`)) ??
      prs.find((p) => existingBranches.includes(p.headRefName)) ??
      null
  } catch {
    linkedPr = null
  }
}

function summarize(issue) {
  return {
    numero: issue.number,
    titre: issue.title,
    etat: issue.state,
    labels: issue.labels,
    url: issue.url,
    maj: issue.updatedAt,
  }
}

emit({
  state: mission.state,
  reason: null,
  repo,
  branch,
  mission: {
    ...summarize(mission),
    corps: missionBody ? missionBody.slice(0, 1500) : null,
    dernierCommentaire: lastComment,
  },
  brancheExistante: existingBranches.find((b) => b.includes(String(mission.number))) ?? null,
  branchesMission: existingBranches,
  prLiee: linkedPr,
  actionsExecutees: [
    'lecture du remote git (lecture seule)',
    'lecture des issues ouvertes via `gh`',
    'lecture du corps et du dernier commentaire de la mission',
    'inventaire des branches mission/* locales et distantes',
    'recherche d’une PR ouverte liée',
  ],
  actionsNonExecutees: [
    'aucune écriture git',
    'aucune écriture GitHub',
    'aucun merge',
    'aucun déploiement',
    'aucun lancement d’orchestrateur',
  ],
})

// ------------------------------------------------------------ 6. RENDU
function render(p) {
  const L = []
  const ETIQUETTE = {
    READY: 'MISSION PRÊTE',
    REWORK: 'REPRISE DEMANDÉE',
    REVIEW: 'EN REVUE',
    BLOCKED: 'BLOQUÉE',
    NONE: 'AUCUNE MISSION',
    AMBIGUOUS: 'AMBIGUÏTÉ — ARBITRAGE REQUIS',
    UNAVAILABLE: 'INDISPONIBLE',
  }

  L.push('')
  L.push(`  ${ETIQUETTE[p.state] ?? p.state}`)
  if (p.repo) L.push(`  dépôt : ${p.repo}${p.branch ? `  ·  branche : ${p.branch}` : ''}`)
  L.push('')

  if (p.reason) {
    L.push(`  ${p.reason}`)
    L.push('')
  }

  if (p.candidates?.length) {
    L.push('  Candidates à égalité :')
    for (const c of p.candidates) L.push(`    #${c.numero}  ${c.titre}`)
    L.push('')
    L.push('  Départage : retire un label, ou choisis explicitement.')
    L.push('')
  }

  if (p.excluded?.length) {
    L.push('  Issues écartées :')
    for (const e of p.excluded) L.push(`    #${e.numero}  [${e.etat}]  ${e.titre}`)
    L.push('')
  }

  if (p.mission) {
    const m = p.mission
    L.push(`  #${m.numero}  ${m.titre}`)
    L.push(`  ${m.url}`)
    L.push(`  labels : ${m.labels.join(', ')}`)
    L.push(`  mise à jour : ${m.maj}`)
    L.push('')

    if (p.brancheExistante) {
      L.push(`  Branche existante à RÉUTILISER : ${p.brancheExistante}`)
    } else {
      L.push('  Aucune branche de mission — à créer.')
    }

    if (p.prLiee) {
      L.push(`  PR liée : #${p.prLiee.number} ${p.prLiee.isDraft ? '(draft)' : ''} — ${p.prLiee.url}`)
    } else {
      L.push('  Aucune PR ouverte liée.')
    }
    L.push('')

    if (m.dernierCommentaire) {
      L.push(`  Dernier commentaire — ${m.dernierCommentaire.auteur} :`)
      for (const line of m.dernierCommentaire.extrait.split('\n').slice(0, 6)) {
        L.push(`    ${line}`)
      }
      L.push('')
    }
  }

  L.push('  Cette commande n’a rien écrit : ni git, ni GitHub, ni merge, ni déploiement.')
  L.push('')
  console.log(L.join('\n'))
}
