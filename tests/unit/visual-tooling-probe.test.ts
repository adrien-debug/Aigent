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

  it('rend UNAVAILABLE — jamais CONFIGURED — quand aucune adresse n’existe', async () => {
    const { readVisualTooling } = await load()
    const data = await readVisualTooling()

    // Aucune adresse ⇒ aucune sonde ⇒ on ne sait rien. C'est le cœur du contrat.
    for (const tool of data.tools) {
      expect(tool.status).toBe('UNAVAILABLE')
      expect(tool.url).toBeNull()
      expect(tool.checkedAt).toBeNull()
      expect(tool.latencyMs).toBeNull()
    }
    expect(data.runningCount).toBe(0)
  })

  it('passe RUNNING seulement sur une réponse réelle', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200 })),
    )
    const { readVisualTooling } = await load()
    const grafana = (await readVisualTooling()).tools.find((t) => t.id === 'grafana')

    expect(grafana?.status).toBe('RUNNING')
    expect(grafana?.checkedAt).not.toBeNull()
    expect(grafana?.remediation).toBeNull()
  })

  it('retombe sur CONFIGURED — pas RUNNING — quand la sonde échoue', async () => {
    process.env.GRAFANA_URL = 'http://127.0.0.1:3030'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED http://user:motdepasse@127.0.0.1:3030')
      }),
    )
    const { readVisualTooling } = await load()
    const grafana = (await readVisualTooling()).tools.find((t) => t.id === 'grafana')

    expect(grafana?.status).toBe('CONFIGURED')
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

    expect(grafana?.status).toBe('UNAVAILABLE')
    expect(grafana?.url).toBeNull()
  })

  it('déclare Obsidian non mesurable, jamais RUNNING', async () => {
    const { readVisualTooling } = await load()
    const obsidian = (await readVisualTooling()).tools.find((t) => t.id === 'obsidian')

    // Une app de bureau n'a pas de port : un état « sain » serait fabriqué.
    expect(obsidian?.status).toBe('UNAVAILABLE')
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

    expect(tools.find((t) => t.id === 'grafana')?.status).toBe('RUNNING')
    expect(tools.find((t) => t.id === 'n8n')?.status).toBe('CONFIGURED')
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

    expect(lg?.status).toBe('RUNNING')
    expect(lg?.detail).toContain('authentification')
  })
})
