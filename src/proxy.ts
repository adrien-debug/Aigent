import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { timingSafeEqual } from 'node:crypto'

import { SESSION_COOKIE, decodeSession } from '@/lib/agent-mission-control/auth'

/**
 * Aigent — garde d'identité (fail-closed).
 *
 * CE QUI A CHANGÉ, ET POURQUOI.
 *
 * Le matcher ne couvrait que `/api/agent-ops/**`. Les ~20 pages du plan de
 * contrôle vivaient donc HORS de toute garde, et aucune ne vérifiait de session
 * par elle-même : elles lisent PostgREST côté serveur et rendaient à un anonyme
 * les noms de projets, les dépôts liés, le roster, les statuts et les coûts.
 * Ce n'était pas une nuance de configuration — c'était une exposition complète.
 *
 * Le matcher couvre désormais TOUT, et ce sont les exclusions qui sont
 * explicites. C'est le sens correct de la garde : ce qu'on oublie de déclarer
 * se retrouve protégé, pas exposé.
 *
 * TROIS RÉPONSES DISTINCTES, à ne pas confondre :
 *
 *  1. une PAGE sans session      → 302 vers `/sign-in?next=<chemin d'origine>` ;
 *  2. `/api/agent-ops/**` sans session → 401 JSON (comportement préexistant,
 *     délibérément préservé : un client d'API ne suit pas une redirection vers
 *     un formulaire, il doit lire un refus) ;
 *  3. les surfaces runtime (`/api/runtime/v1/**`, `/api/runtime-telemetry/**`)
 *     ne sont PAS interceptées. Elles portent leur PROPRE jeton — un jeton
 *     consommateur, jamais le cookie d'opérateur (`AGENTS.md`, frontières de
 *     confiance). Les intercepter ici les casserait, et les faire dépendre du
 *     cookie mélangerait deux identités qui doivent rester séparées.
 */

/** Préfixes atteignables sans session — la liste est courte et fermée. */
const PUBLIC_PREFIXES = [
  '/_next/',
  '/api/auth/',
  // Surfaces runtime : authentifiées par leur propre jeton, pas par le cookie.
  '/api/runtime/v1',
  '/api/runtime-telemetry',
] as const

/** Chemins exacts atteignables sans session. */
const PUBLIC_PATHS = new Set(['/favicon.ico', '/logout', '/sign-in'])

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true
  return PUBLIC_PREFIXES.some((prefix) => path.startsWith(prefix))
}

export function proxy(request: NextRequest) {
  const url = new URL(request.url)
  const path = url.pathname

  if (request.method === 'OPTIONS') return NextResponse.next()
  if (isPublic(path)) return NextResponse.next()

  const session = decodeSession(readSessionCookie(request))
  if (session) return NextResponse.next()

  // Automatisation serveur-à-serveur : la clé partagée reste acceptée sur les
  // routes d'opération, jamais sur les pages (une page ne se lit pas avec un
  // header d'automatisation).
  const apiKey = process.env.AMC_API_KEY
  const providedKey = request.headers.get('x-amc-key')
  if (path.startsWith('/api/agent-ops/') && apiKey && providedKey) {
    if (constantTimeEqual(providedKey, apiKey)) return NextResponse.next()
  }

  // Toute route d'API refuse en JSON. Renvoyer une redirection HTML à un
  // appelant d'API transformerait un 401 lisible en 200 trompeur.
  if (path.startsWith('/api/')) {
    return NextResponse.json({ ok: false, error: 'Authentication required' }, { status: 401 })
  }

  const signIn = new URL('/sign-in', request.url)
  // Le chemin d'origine, RELATIF, pour revenir où l'opérateur allait. Il est
  // reconstruit à partir de `pathname` + `search` du même URL — jamais d'un
  // en-tête fourni par l'appelant — et il est revalidé à la lecture côté
  // `/sign-in` : un `next` qui n'est pas un chemin interne y est ignoré.
  signIn.searchParams.set('next', `${path}${url.search}`)
  return NextResponse.redirect(signIn, 302)
}

function readSessionCookie(request: NextRequest): string | undefined {
  return request.cookies.get(SESSION_COOKIE)?.value
}

/** Constant-time comparison of two UTF-8 strings; safe against length mismatches. */
function constantTimeEqual(a: string, b: string): boolean {
  try {
    const aBuf = Buffer.from(a, 'utf8')
    const bBuf = Buffer.from(b, 'utf8')
    if (aBuf.length !== bBuf.length) return false
    return timingSafeEqual(aBuf, bBuf)
  } catch {
    return false
  }
}

export const config = {
  /**
   * Tout est gardé sauf ce qui est nommé ici. Les exclusions du matcher sont un
   * FILTRE DE PERFORMANCE (statiques Next, favicon) ; l'autorité fonctionnelle
   * reste `isPublic()` ci-dessus, qui s'exécute sur tout ce qui passe.
   */
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
