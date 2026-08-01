/**
 * `/next` — sélection de mission.
 *
 * Testé via un faux `gh`/`git` sur le PATH : la commande réelle est exécutée
 * de bout en bout (parsing, classement, ambiguïté, rendu) sans toucher à
 * GitHub ni muter une vraie issue. Un test qui appellerait le vrai `gh`
 * dépendrait du réseau et de l'état des issues du jour — il mesurerait la
 * météo, pas le code.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const SCRIPT = new URL('../../scripts/next-mission.mjs', import.meta.url).pathname

let binDir: string

/** Installe un faux exécutable qui répond selon ses arguments. */
function fakeBin(name: string, script: string): void {
  const path = join(binDir, name)
  writeFileSync(path, `#!/bin/sh\n${script}\n`)
  chmodSync(path, 0o755)
}

/** Faux `git` : remote GitHub + branche, toujours en lecture seule. */
function fakeGit(branches = 'main'): void {
  fakeBin(
    'git',
    `case "$*" in
  *"remote get-url"*) echo "https://github.com/adrien-debug/Aigent.git" ;;
  *"rev-parse"*) echo "mission/test" ;;
  *"branch"*) printf '${branches}\\n' ;;
  *) exit 0 ;;
esac`
  )
}

/** Faux `gh` : renvoie la liste d'issues fournie. */
function fakeGh(issues: unknown[], opts: { auth?: boolean } = {}): void {
  const authLine = opts.auth === false ? 'exit 1' : 'echo "ok"'
  fakeBin(
    'gh',
    `case "$*" in
  *"--version"*) echo "gh 2.0.0" ;;
  *"auth status"*) ${authLine} ;;
  *"issue list"*) cat <<'JSON'
${JSON.stringify(issues)}
JSON
  ;;
  *"issue view"*) echo '{"body":"corps de mission","comments":[]}' ;;
  *"pr list"*) echo '[]' ;;
  *) echo '[]' ;;
esac`
  )
}

function runNext(): { code: number; out: string } {
  try {
    const out = execFileSync('node', [SCRIPT, '--json'], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${binDir}:${process.env.PATH}` },
    })
    return { code: 0, out }
  } catch (err) {
    const e = err as { status?: number; stdout?: string }
    return { code: e.status ?? 1, out: e.stdout ?? '' }
  }
}

function issue(number: number, title: string, labels: string[]) {
  return {
    number,
    title,
    labels: labels.map((name) => ({ name })),
    updatedAt: '2026-08-01T00:00:00Z',
    url: `https://github.com/adrien-debug/Aigent/issues/${number}`,
  }
}

beforeEach(() => {
  binDir = mkdtempSync(join(tmpdir(), 'next-bin-'))
})

afterEach(() => {
  rmSync(binDir, { recursive: true, force: true })
})

describe('/next', () => {
  it('sélectionne l’unique mission ready', () => {
    fakeGit()
    fakeGh([issue(68, 'Stack visuelle', ['orchestrator:ready'])])
    const { out } = runNext()
    const p = JSON.parse(out)

    expect(p.state).toBe('READY')
    expect(p.mission.numero).toBe(68)
  })

  it('donne la priorité à un rework sur un ready', () => {
    fakeGit()
    fakeGh([
      issue(68, 'Stack visuelle', ['orchestrator:ready']),
      issue(70, 'Reprise cockpit', ['orchestrator:rework']),
    ])
    const p = JSON.parse(runNext().out)

    // Une reprise est plus urgente qu'un démarrage.
    expect(p.state).toBe('REWORK')
    expect(p.mission.numero).toBe(70)
  })

  it('REFUSE de choisir entre deux missions de même priorité', () => {
    fakeGit()
    fakeGh([
      issue(68, 'Stack visuelle', ['orchestrator:ready']),
      issue(24, 'Frontend rebuild', ['orchestrator:ready']),
    ])
    const p = JSON.parse(runNext().out)

    expect(p.state).toBe('AMBIGUOUS')
    expect(p.mission).toBeNull()
    expect(p.candidates).toHaveLength(2)
  })

  it('rend NONE quand aucune issue ne porte de label d’orchestration', () => {
    fakeGit()
    fakeGh([issue(12, 'Bug quelconque', ['bug'])])
    const p = JSON.parse(runNext().out)

    expect(p.state).toBe('NONE')
    expect(p.mission).toBeNull()
  })

  it('écarte une mission bloquée sans la sélectionner', () => {
    fakeGit()
    fakeGh([issue(9, 'Attente secret', ['orchestrator:blocked'])])
    const p = JSON.parse(runNext().out)

    expect(p.state).toBe('BLOCKED')
    expect(p.mission).toBeNull()
  })

  it('distingue UNAVAILABLE de NONE quand gh n’est pas authentifié', () => {
    fakeGit()
    fakeGh([], { auth: false })
    const { code, out } = runNext()
    const p = JSON.parse(out)

    // La distinction critique : « je n'ai pas pu lire » n'est pas
    // « il n'y a rien ». Confondre les deux ferait croire au travail fini.
    expect(p.state).toBe('UNAVAILABLE')
    expect(code).toBe(2)
  })

  it('n’expose aucune action d’écriture', () => {
    fakeGit()
    fakeGh([issue(68, 'Stack visuelle', ['orchestrator:ready'])])
    const p = JSON.parse(runNext().out)

    expect(p.actionsNonExecutees).toContain('aucun merge')
    expect(p.actionsNonExecutees).toContain('aucun déploiement')
    for (const action of p.actionsExecutees as string[]) {
      expect(action).toMatch(/lecture|inventaire|recherche/)
    }
  })

  it('signale une branche de mission existante à réutiliser', () => {
    fakeGit('main\\nmission/aigent-visual-stack-68')
    fakeGh([issue(68, 'Stack visuelle', ['orchestrator:ready'])])
    const p = JSON.parse(runNext().out)

    expect(p.brancheExistante).toBe('mission/aigent-visual-stack-68')
  })
})
