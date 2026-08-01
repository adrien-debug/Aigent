import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Les sondes Visual Tooling — ce qui est vérifié ici est la propriété la plus
 * facile à casser sans s'en apercevoir : ne JAMAIS afficher un état plus fort
 * que ce qu'on a mesuré, et ne jamais laisser fuir un secret.
 */

const ENV_KEYS = ['LANGGRAPH_API_URL', 'LANGFUSE_BASEURL', 'LANGFUSE_HOST', 'GRAFANA_URL', 'N8N_URL'] as const

function clearEnv() {
  for (const key of ENV_KEYS) delete process.env[key]
}

async function load() {
  vi.resetModules()
  return import('@/components/runtime/visual-tooling')
}

describe('readVisualTooling', () => {
  beforeEach(() => {
    clearEnv()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    clearEnv()
  })

  it('rend NOT_CONFIGURED — jamais CONFIGURED — quand aucune adresse n’existe', async () => {
    const { readVisualTooling } = await load()
    const data = await readVisualTooling()

    /*
      Aucune adresse ⇒ aucune sonde ⇒ on ne sait rien. C'est le cœur du contrat.

      `canvas-aigent` est exclu : ce n'est pas un service sondable mais une
      surface embarquée dans ce produit, dont l'état ne dépend d'aucune variable
      d'environnement. Il est traité par son propre test.
    */
    const probed = data.tools.filter((t) => t.id !== 'canvas-aigent')
    expect(probed).toHaveLength(6)

    // Les outils RÉELLEMENT sondés par URL : sans adresse, ils sont
    // NOT_CONFIGURED. NOT_CONFIGURED ≠ ERROR : rien à sonder n'est pas
    // « sondé et cassé ».
    const SONDABLES = ['langgraph', 'langfuse', 'grafana', 'n8n']
    for (const tool of probed.filter((t) => SONDABLES.includes(t.id))) {
      expect(tool.status).toBe('NOT_CONFIGURED')
      expect(tool.url).toBeNull()
      expect(tool.checkedAt).toBeNull()
      expect(tool.latencyMs).toBeNull()
    }

    // Les deux outils NON sondables gardent leur état propre, qui ne dépend
    // d'aucune variable d'environnement :
    //  - Studio est DÉRIVÉ de l'état de LangGraph → UNAVAILABLE quand il est
    //    absent (on ne peut rien en dire, et ce n'est pas « mal configuré ») ;
    //  - Obsidian est un artefact du repository → INSTALLED, toujours.
    expect(probed.find((t) => t.id === 'langsmith-studio')?.status).toBe('UNAVAILABLE')
    expect(probed.find((t) => t.id === 'obsidian')?.status).toBe('INSTALLED')
    // Seul le Canvas est « atteint » — il est rendu, pas joint.
    expect(data.runningCount).toBe(1)
  })

  it('expose exactement 7 outils, dont Canvas Aigent', async () => {
    const { readVisualTooling } = await load()
    const data = await readVisualTooling()

    expect(data.tools).toHaveLength(7)
    expect(data.tools.map((t) => t.id)).toEqual([
      'langgraph',
      'canvas-aigent',
      'langsmith-studio',
      'langfuse',
      'grafana',
      'n8n',
      'obsidian',
    ])
  })

  it('le Canvas est VERIFIED sans sonde — sa preuve est le rendu, pas un 200', async () => {
    const { readVisualTooling } = await load()
    const canvas = (await readVisualTooling()).tools.find((t) => t.id === 'canvas-aigent')

    expect(canvas?.status).toBe('VERIFIED')
    // Jamais sondé : aucune latence, aucun horodatage de contrôle fabriqué.
    expect(canvas?.latencyMs).toBeNull()
    expect(canvas?.checkedAt).toBeNull()
    // Lien INTERNE : il ne part pas vers un tiers.
    expect(canvas?.url).toBe('/runtime?tab=langgraph')
  })

  it('n’accorde VERIFIED à AUCUN service sondé', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    process.env.LANGFUSE_BASEURL = 'http://127.0.0.1:3999'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    const { readVisualTooling } = await load()
    const probed = (await readVisualTooling()).tools.filter((t) => t.id !== 'canvas-aigent')

    // Un 200 ne prouve pas qu'un service fait son travail : plafond CONNECTED.
    expect(probed.every((t) => t.status !== 'VERIFIED')).toBe(true)
  })

  it('passe CONNECTED seulement sur une réponse réelle et acceptée', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    const { readVisualTooling } = await load()
    const grafana = (await readVisualTooling()).tools.find((t) => t.id === 'grafana')

    expect(grafana?.status).toBe('CONNECTED')
    expect(grafana?.checkedAt).not.toBeNull()
    expect(grafana?.remediation).toBeNull()
  })

  it('retombe sur ERROR — pas RUNNING — quand la sonde échoue', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED http://user:motdepasse@127.0.0.1:3030')
      }),
    )
    const { readVisualTooling } = await load()
    const grafana = (await readVisualTooling()).tools.find((t) => t.id === 'grafana')

    // Adresse connue + service muet = ERREUR constatée, pas « à configurer ».
    expect(grafana?.status).toBe('ERROR')
    expect(grafana?.remediation).not.toBeNull()
    // Le message d'origine portait un mot de passe : il ne doit PAS ressortir.
    expect(grafana?.detail).not.toContain('motdepasse')
    expect(grafana?.detail).not.toContain('ECONNREFUSED')
  })

  it('ne laisse jamais sortir les identifiants présents dans une URL', async () => {
    process.env.N8N_URL = 'http://admin:supersecret@127.0.0.1:5678/path?token=abc123'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    const { readVisualTooling } = await load()
    const n8n = (await readVisualTooling()).tools.find((t) => t.id === 'n8n')

    const serialized = JSON.stringify(n8n)
    expect(serialized).not.toContain('supersecret')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('admin')
  })

  it('ignore une URL malformée plutôt que de la sonder', async () => {
    process.env.GRAFANA_URL = 'pas-une-url'
    const { readVisualTooling } = await load()
    const grafana = (await readVisualTooling()).tools.find((t) => t.id === 'grafana')

    expect(grafana?.status).toBe('NOT_CONFIGURED')
    expect(grafana?.url).toBeNull()
  })

  it('déclare Obsidian INSTALLED — vault présent — mais jamais RUNNING ni VERIFIED', async () => {
    const { readVisualTooling } = await load()
    const obsidian = (await readVisualTooling()).tools.find((t) => t.id === 'obsidian')

    // Une app de bureau n'a pas de port : un état « sain » serait fabriqué.
    // Le vault versionné est un fait vérifiable ; l'exécution de
    // l'application de bureau ne l'est pas. INSTALLED dit exactement cela.
    expect(obsidian?.status).toBe('INSTALLED')
    expect(obsidian?.status).not.toBe('VERIFIED')
    expect(obsidian?.latencyMs).toBeNull()
    expect(obsidian?.detail).toContain('aucun port HTTP')
  })

  it('isole les sondes : un outil down n’en dégrade pas un autre', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    process.env.N8N_URL = 'http://127.0.0.1:5678'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        if (String(input).includes('5678')) throw new Error('down')
        return new Response('ok', { status: 200 })
      }),
    )
    const { readVisualTooling } = await load()
    const tools = (await readVisualTooling()).tools

    expect(tools.find((t) => t.id === 'grafana')?.status).toBe('CONNECTED')
    expect(tools.find((t) => t.id === 'n8n')?.status).toBe('ERROR')
  })

  it('ne prétend jamais que Studio tourne quand l’Agent Server est muet', async () => {
    // Studio est HÉBERGÉ : smith.langchain.com répond même serveur local éteint.
    // Un RUNNING basé là-dessus serait un faux vert.
    const { readVisualTooling } = await load()
    const studio = (await readVisualTooling()).tools.find((t) => t.id === 'langsmith-studio')

    expect(studio?.status).toBe('UNAVAILABLE')
    expect(studio?.url).toBeNull()
  })

  it('dit explicitement qu’un 401 est un refus, pas une panne', async () => {
    process.env.LANGGRAPH_API_URL = 'http://127.0.0.1:2024'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 401 })),
    )
    const { readVisualTooling } = await load()
    const lg = (await readVisualTooling()).tools.find((t) => t.id === 'langgraph')

    // Répondu mais refusé : on s'arrête à RUNNING, jamais CONNECTED.
    expect(lg?.status).toBe('RUNNING')
    expect(lg?.detail).toContain('authentification')
  })
})
