import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { NextRequest } from 'next/server'
import { beforeAll, describe, expect, it } from 'vitest'

import { proxy, config } from '@/proxy'
import { SESSION_COOKIE, createAdminSessionCookie } from '@/lib/agent-mission-control/auth'
import { safeReturnTo, DEFAULT_RETURN_TO } from '@/app/sign-in/return-to'

/**
 * AIGENT-HARDENING-PRODUCTION-001 — les PAGES n'étaient gardées par rien.
 *
 * Le matcher du proxy ne couvrait que `/api/agent-ops/**`, et aucune des ~20
 * pages ne vérifiait de session par elle-même : un anonyme lisait le roster,
 * les projets, les dépôts liés, les statuts et les coûts. Ces tests figent la
 * nouvelle posture ET les trois exceptions qui doivent survivre.
 */

const ORIGIN = 'https://aigent.test'

beforeAll(() => {
  process.env.AMC_SESSION_SECRET = 'unit-test-session-secret-0123456789'
  delete process.env.AMC_API_KEY
})

function cookieValue(setCookie: string): string {
  return setCookie.slice(`${SESSION_COOKIE}=`.length).split(';')[0]
}

function request(path: string, opts: { session?: boolean; headers?: Record<string, string> } = {}) {
  const headers = new Headers(opts.headers ?? {})
  if (opts.session) headers.set('cookie', `${SESSION_COOKIE}=${cookieValue(createAdminSessionCookie())}`)
  return new NextRequest(new URL(path, ORIGIN), { headers })
}

describe('proxy — les pages exigent une session', () => {
  const guardedPages = ['/', '/projects', '/agents', '/runs', '/delivery', '/qualification', '/builder']

  for (const path of guardedPages) {
    it(`redirige ${path} vers /sign-in quand aucune session n'est présente`, () => {
      const res = proxy(request(path))
      expect(res.status).toBe(302)
      const location = new URL(res.headers.get('location') ?? '', ORIGIN)
      expect(location.pathname).toBe('/sign-in')
      // Le chemin d'origine est conservé pour y revenir après connexion.
      expect(location.searchParams.get('next')).toBe(path)
    })
  }

  it('conserve la query string du chemin d’origine dans `next`', () => {
    const res = proxy(request('/runs?run=abc123'))
    const location = new URL(res.headers.get('location') ?? '', ORIGIN)
    expect(location.searchParams.get('next')).toBe('/runs?run=abc123')
  })

  it('laisse passer une page quand la session est valide', () => {
    const res = proxy(request('/agents', { session: true }))
    expect(res.status).toBe(200)
    expect(res.headers.get('location')).toBeNull()
  })

  it('ne redirige PAS /sign-in lui-même (sinon boucle infinie)', () => {
    expect(proxy(request('/sign-in')).status).toBe(200)
    expect(proxy(request('/logout')).status).toBe(200)
  })

  it('n’accepte pas x-amc-key pour ouvrir une PAGE', () => {
    process.env.AMC_API_KEY = 'automation-key'
    try {
      const res = proxy(request('/agents', { headers: { 'x-amc-key': 'automation-key' } }))
      // La clé d'automatisation sert les routes d'opération, pas les écrans.
      expect(res.status).toBe(302)
      expect(new URL(res.headers.get('location') ?? '', ORIGIN).pathname).toBe('/sign-in')
    } finally {
      delete process.env.AMC_API_KEY
    }
  })
})

describe('proxy — /api/agent-ops/** répond 401 JSON, jamais une redirection', () => {
  it('refuse en JSON sans session', async () => {
    const res = proxy(request('/api/agent-ops/copilots'))
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
    expect(res.headers.get('content-type')).toContain('application/json')
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Authentication required' })
  })

  it('laisse passer avec une session valide', () => {
    expect(proxy(request('/api/agent-ops/copilots', { session: true })).status).toBe(200)
  })

  it('laisse passer avec x-amc-key correct', () => {
    process.env.AMC_API_KEY = 'automation-key'
    try {
      const res = proxy(request('/api/agent-ops/copilots', { headers: { 'x-amc-key': 'automation-key' } }))
      expect(res.status).toBe(200)
    } finally {
      delete process.env.AMC_API_KEY
    }
  })

  it('refuse x-amc-key incorrect sur /api/agent-ops', () => {
    process.env.AMC_API_KEY = 'automation-key'
    try {
      const res = proxy(request('/api/agent-ops/copilots', { headers: { 'x-amc-key': 'wrong-key' } }))
      expect(res.status).toBe(401)
    } finally {
      delete process.env.AMC_API_KEY
    }
  })

  it('n’accepte pas x-amc-key sur une route API hors /api/agent-ops', () => {
    process.env.AMC_API_KEY = 'automation-key'
    try {
      const res = proxy(request('/api/quelque-chose', { headers: { 'x-amc-key': 'automation-key' } }))
      expect(res.status).toBe(401)
    } finally {
      delete process.env.AMC_API_KEY
    }
  })
})

describe('proxy — les surfaces à jeton propre ne sont pas interceptées', () => {
  /**
   * Ces surfaces s'authentifient avec LEUR jeton (consommateur / télémétrie),
   * jamais avec le cookie d'opérateur (`AGENTS.md`, frontières de confiance).
   * Les intercepter ici les casserait ; les faire dépendre du cookie
   * mélangerait deux identités qui doivent rester séparées.
   */
  const ownTokenSurfaces = [
    '/api/runtime/v1/agents',
    '/api/runtime-telemetry',
    '/api/runtime-telemetry/consumer',
    '/api/auth/login',
  ]

  for (const path of ownTokenSurfaces) {
    it(`laisse passer ${path} sans session`, () => {
      const res = proxy(request(path))
      expect(res.status).toBe(200)
      expect(res.headers.get('location')).toBeNull()
    })
  }

  it('refuse en revanche toute AUTRE route d’API sans session, en JSON', () => {
    const res = proxy(request('/api/quelque-chose'))
    expect(res.status).toBe(401)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('proxy — le matcher couvre les pages', () => {
  it('le matcher n’est plus restreint à /api/agent-ops', () => {
    expect(config.matcher).not.toEqual(['/api/agent-ops/:path*'])
    const matcher = config.matcher[0]
    // Le motif doit accepter une page quelconque et exclure les statiques Next.
    const re = new RegExp(`^${matcher}$`)
    expect(re.test('/agents')).toBe(true)
    expect(re.test('/')).toBe(true)
    expect(re.test('/_next/static/chunk.js')).toBe(false)
    expect(re.test('/favicon.ico')).toBe(false)
  })
})

describe('safeReturnTo — pas de redirection ouverte', () => {
  const refused = [
    'https://evil.tld',
    'http://evil.tld/path',
    '//evil.tld',
    '/\\evil.tld',
    'javascript:alert(1)',
    'dashboard',
    '',
    '/sign-in',
    '/sign-in?next=/agents',
    `/${'x'.repeat(600)}`,
  ]

  for (const raw of refused) {
    it(`refuse ${JSON.stringify(raw)} et retombe sur ${DEFAULT_RETURN_TO}`, () => {
      expect(safeReturnTo(raw)).toBe(DEFAULT_RETURN_TO)
    })
  }

  it('refuse une valeur contenant un caractère de contrôle', () => {
    expect(safeReturnTo('/agents\nSet-Cookie: x=1')).toBe(DEFAULT_RETURN_TO)
    expect(safeReturnTo('/agents\r')).toBe(DEFAULT_RETURN_TO)
  })

  it('refuse null / undefined', () => {
    expect(safeReturnTo(null)).toBe(DEFAULT_RETURN_TO)
    expect(safeReturnTo(undefined)).toBe(DEFAULT_RETURN_TO)
  })

  const accepted = ['/', '/agents', '/runs?run=abc', '/projects/p_1#section']
  for (const raw of accepted) {
    it(`accepte le chemin interne ${raw}`, () => {
      expect(safeReturnTo(raw)).toBe(raw)
    })
  }
})

describe('aucune page ne rend un message interne', () => {
  /**
   * Garde TEXTUELLE. Elle ne prouve pas l'absence de toute fuite — un détail
   * peut passer par un helper — mais elle fige la forme qui a réellement fui
   * ici : `err.message` interpolé dans le JSX d'une page.
   */
  async function* walk(dir: string): AsyncGenerator<string> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) yield* walk(full)
      else if (entry.name.endsWith('.tsx')) yield full
    }
  }

  it('aucun `.message` dans src/app/**/*.tsx', async () => {
    const offenders: string[] = []
    for await (const file of walk(join(process.cwd(), 'src/app'))) {
      const source = await readFile(file, 'utf8')
      // On cible l'accès au message d'une erreur, pas les identifiants qui
      // contiennent le mot (`bundle.messages`, `state.message` d'un formulaire).
      if (/\b(err|error|e|reason|cause)\s*(\.|\?\.)message\b/.test(source)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('la garde détecte bien la forme fautive (sonde en sens inverse)', () => {
    const fautif = "const failure = err instanceof Error ? err.message : 'x'"
    expect(/\b(err|error|e|reason|cause)\s*(\.|\?\.)message\b/.test(fautif)).toBe(true)
  })
})
