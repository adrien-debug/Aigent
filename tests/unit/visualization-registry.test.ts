/**
 * Registre et allowlist des visualisations — AIGENT-VISUALIZATION-LAB-003.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *   1. l'allowlist REJETTE une origine étrangère — sans quoi l'embed devient un
 *      SSRF piloté depuis le registre ;
 *   2. un mode non implémenté ne peut JAMAIS atteindre `READY` ;
 *   3. aucun credential ne se retrouve dans une URL rendue au client ;
 *   4. chaque refus produit un état honnête, pas un cadre vide.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const ORIGINAL_ENV = { ...process.env }

async function load() {
  vi.resetModules()
  return import('@/components/visualizations/embed/registry')
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV, GRAFANA_URL: 'http://127.0.0.1:3802' }
  vi.restoreAllMocks()
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
})

describe('allowlist', () => {
  it('REJETTE une origine étrangère — sonde négative', async () => {
    const { isAllowedOrigin } = await load()

    // Le cœur de la sécurité de ce lot. Chacune de ces URL doit être refusée.
    expect(isAllowedOrigin('https://evil.example.com/d-solo/x')).toBe(false)
    expect(isAllowedOrigin('http://grafana.internal:3802/d-solo/x')).toBe(false)
    // Piège classique : un préfixe de chaîne accepterait ce domaine.
    expect(isAllowedOrigin('http://127.0.0.1:3802.evil.tld/d-solo/x')).toBe(false)
    // Port différent = origine différente.
    expect(isAllowedOrigin('http://127.0.0.1:9999/d-solo/x')).toBe(false)
    // Schéma différent = origine différente.
    expect(isAllowedOrigin('https://127.0.0.1:3802/d-solo/x')).toBe(false)
    expect(isAllowedOrigin('pas-une-url')).toBe(false)
  })

  it('accepte exactement l’origine configurée', async () => {
    const { isAllowedOrigin } = await load()
    expect(isAllowedOrigin('http://127.0.0.1:3802/d-solo/aigent-runs/x?panelId=1')).toBe(true)
  })

  it('est vide — donc tout refuse — quand GRAFANA_URL est absent', async () => {
    delete process.env.GRAFANA_URL
    const { allowedOrigins, isAllowedOrigin } = await load()

    expect(allowedOrigins()).toEqual([])
    expect(isAllowedOrigin('http://127.0.0.1:3802/x')).toBe(false)
  })

  it('ne conserve que schéma et hôte — un credential dans la variable ne fuit pas', async () => {
    process.env.GRAFANA_URL = 'http://user:motdepasse@127.0.0.1:3802/chemin?token=secret'
    const { allowedOrigins } = await load()

    const origins = allowedOrigins()
    expect(origins).toHaveLength(1)
    expect(origins[0]).not.toContain('motdepasse')
    expect(origins[0]).not.toContain('secret')
    expect(origins[0]).not.toContain('chemin')
  })
})

describe('resolveVisualization', () => {
  it('rend READY et une URL sans credential quand la source répond', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html></html>', { status: 200 })),
    )
    const { resolveVisualization } = await load()
    const viz = await resolveVisualization('runs-volume')

    expect(viz?.state).toBe('READY')
    expect(viz?.embedUrl).toContain('/d-solo/aigent-runs/')
    expect(viz?.embedUrl).toContain('panelId=1')
    // Aucun secret ne doit voyager dans une URL rendue au client.
    for (const forbidden of ['token', 'password', 'apikey', 'auth', '@']) {
      expect(viz?.embedUrl.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('N’ATTEINT JAMAIS READY pour un mode non implémenté — sonde négative', async () => {
    const { isImplementedKind } = await import('@/components/visualizations/embed/contract')

    /*
     * Le garde qui rend `READY` inatteignable pour un mode non implémenté est
     * `isImplementedKind()` : `resolveVisualization()` s'en sert avant toute
     * construction d'URL. On le teste directement plutôt qu'à travers un
     * `spyOn` du registre — la fonction est appelée en interne, pas via
     * l'objet module, donc un espion ne l'intercepterait pas et le test
     * passerait pour de mauvaises raisons.
     */
    expect(isImplementedKind('grafana-panel')).toBe(true)
    for (const declaredButUnimplemented of ['iframe', 'image-renderer', 'vega-spec']) {
      expect(isImplementedKind(declaredButUnimplemented)).toBe(false)
    }
    expect(isImplementedKind('n-importe-quoi')).toBe(false)

    // Et le registre livré ne contient QUE des modes implémentés : aucune
    // entrée ne peut donc afficher un cadre vide présenté comme fonctionnel.
    const { VISUALIZATIONS } = await load()
    for (const viz of VISUALIZATIONS) {
      expect(isImplementedKind(viz.kind)).toBe(true)
    }
  })

  it('rend NOT_CONFIGURED — pas UNAVAILABLE — quand aucune adresse n’existe', async () => {
    delete process.env.GRAFANA_URL
    const { resolveVisualization } = await load()
    const viz = await resolveVisualization('runs-volume')

    // « Rien à sonder » n'est pas « sondé et cassé ».
    expect(viz?.state).toBe('NOT_CONFIGURED')
    expect(viz?.embedUrl).toBe('')
  })

  it('traite une redirection vers un login comme UNAVAILABLE, pas comme un succès', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 302, headers: { location: '/login' } })),
    )
    const { resolveVisualization } = await load()
    const viz = await resolveVisualization('runs-volume')

    expect(viz?.state).toBe('UNAVAILABLE')
    expect(viz?.reason).toContain('authentification')
    expect(viz?.embedUrl).toBe('')
  })

  it('détecte X-Frame-Options plutôt que d’afficher un cadre blanc', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200, headers: { 'x-frame-options': 'deny' } })),
    )
    const { resolveVisualization } = await load()
    const viz = await resolveVisualization('runs-volume')

    expect(viz?.state).toBe('UNAVAILABLE')
    expect(viz?.reason).toContain('X-Frame-Options')
  })

  it('déclare UNAVAILABLE — jamais READY — sur timeout', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const err = new Error('timed out')
        err.name = 'TimeoutError'
        throw err
      }),
    )
    const { resolveVisualization } = await load()
    const viz = await resolveVisualization('runs-volume')

    expect(viz?.state).toBe('UNAVAILABLE')
    expect(viz?.embedUrl).toBe('')
  })

  it('retourne null sur un identifiant inconnu — aucune URL fabriquée', async () => {
    const { resolveVisualization } = await load()
    expect(await resolveVisualization('inexistant')).toBeNull()
  })

  it('expose les huit panneaux du dashboard, tous en grafana-panel', async () => {
    const { VISUALIZATIONS } = await load()

    expect(VISUALIZATIONS).toHaveLength(8)
    for (const viz of VISUALIZATIONS) {
      expect(viz.kind).toBe('grafana-panel')
      expect(viz.dashboardUid).toBe('aigent-runs')
      expect(viz.provenance).toContain('runtime_telemetry_events')
    }
    // Les identifiants de panneaux relevés dans le dashboard versionné
    // (`deploy/observability/grafana/dashboards/aigent-runs.json`). Le registre
    // en portait quatre — les pilotes du laboratoire ; les quatre autres
    // existaient déjà dans le dashboard sans être adressables depuis Aigent.
    expect(VISUALIZATIONS.map((v) => v.panelId).sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ])
  })

  it('aucun identifiant ni panelId en double — un panneau, une entrée', async () => {
    const { VISUALIZATIONS } = await load()

    // Un doublon afficherait le même graphique sous deux titres, et deux pages
    // pourraient diverger sur ce qu'il montre. Le registre est l'autorité.
    expect(new Set(VISUALIZATIONS.map((v) => v.id)).size).toBe(VISUALIZATIONS.length)
    expect(new Set(VISUALIZATIONS.map((v) => v.panelId)).size).toBe(VISUALIZATIONS.length)
  })

  it('la sélection par fonction ne rend que les panneaux de cette fonction', async () => {
    const { visualizationsFor, VISUALIZATIONS } = await load()

    // C'est ce qui permet à une page de demander « la fiabilité » sans citer
    // d'identifiant en dur : si ce filtre laissait passer autre chose, `/runs`
    // afficherait des panneaux que son éditorial exclut.
    for (const fn of ['activity', 'reliability', 'performance', 'agents'] as const) {
      const picked = visualizationsFor(fn)
      expect(picked.length).toBeGreaterThan(0)
      for (const viz of picked) expect(viz.fn).toBe(fn)
    }

    // La réunion des quatre fonctions couvre le registre entier : aucun panneau
    // n'est orphelin, donc aucun n'est inatteignable depuis une page.
    expect(visualizationsFor('activity', 'reliability', 'performance', 'agents')).toHaveLength(
      VISUALIZATIONS.length,
    )
  })
})
