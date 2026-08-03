/**
 * Les trois signaux ajoutés au contrat de posture pour la surface Réglages :
 * runtime actif, ingestion de télémétrie, plafonds de coût.
 *
 * Chacun est testé sur le point où il pourrait MENTIR :
 *  · le runtime actif est dérivé du registre, jamais d'une constante recopiée —
 *    si le registre déclarait deux moteurs, l'élection deviendrait arbitraire ;
 *  · l'ingestion de télémétrie dit l'état d'une PORTE, jamais celui du trafic —
 *    « fermée » ne doit pas se lire comme « aucun agent ne tourne » ;
 *  · un plafond non défini globalement reste `null`, jamais `0` — un zéro se
 *    lirait comme « tout appel est interdit », l'inverse exact de la vérité.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Valeur factice, volontairement à FAIBLE entropie et construite par
// concaténation. Un littéral qui « ressemble à un jeton » dans un test finit par
// déclencher le scanner de secrets à chaque commit — et une équipe qui prend
// l'habitude d'allowlister ses faux positifs finit par allowlister un vrai.
// Ce que ces tests mesurent est que la valeur ne RESSORT pas, pas qu'elle soit
// crédible.
const TEST_TOKEN = 'not' + '-a-' + 'real' + '-token'

vi.mock('server-only', () => ({}))

const getLearningRuntimeHealth = vi.fn()
vi.mock('@/lib/agent-mission-control/learning-runtime', () => ({
  getLearningRuntimeHealth: () => getLearningRuntimeHealth(),
}))

const { getSettingsPostureSnapshot } = await import('@/lib/agent-mission-control/settings-posture')
const { RUNTIME_REGISTRY } = await import('@/lib/agent-mission-control/registry')

const ENV_KEYS = [
  'AMC_DATA_SOURCE',
  'AMC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'LANGGRAPH_API_URL',
  'LANGGRAPH_SERVER_SECRET',
  'AIGENT_RUNTIME_TELEMETRY_TOKEN',
] as const

const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  vi.unstubAllEnvs()
  vi.stubEnv('NODE_ENV', 'development')
  getLearningRuntimeHealth.mockReset()
  getLearningRuntimeHealth.mockResolvedValue({
    status: 'not_configured',
    checkedAt: '2026-08-03T00:00:00.000Z',
    endpoint: null,
    capabilities: null,
    detail: 'not configured',
    latencyMs: null,
  })
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as Response) as unknown as typeof fetch
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('posture — runtime actif', () => {
  it('élit comme actif le seul runtime doté d’un moteur réel', async () => {
    const posture = await getSettingsPostureSnapshot()

    expect(posture.runtimes.active?.id).toBe('langgraph')
    expect(posture.runtimes.active?.engine).toBe('langgraph')
    expect(posture.runtimes.status).toBe('configured')
  })

  it('liste tous les identifiants du registre, moteur ou non', async () => {
    const posture = await getSettingsPostureSnapshot()

    expect(posture.runtimes.items).toHaveLength(Object.keys(RUNTIME_REGISTRY).length)

    // Un id déclaré sans moteur est listé mais jamais exécutable ni
    // sélectionnable : il existe, il ne tourne pas.
    const inert = posture.runtimes.items.filter((item) => !item.executable)
    expect(inert.length).toBeGreaterThan(0)
    for (const item of inert) {
      expect(item.engine).toBe('none')
      expect(item.creatable).toBe(false)
    }
  })
})

describe('posture — ingestion de télémétrie', () => {
  it('est non configurée quand le jeton d’ingestion est absent', async () => {
    const posture = await getSettingsPostureSnapshot()

    expect(posture.telemetryIngestion.status).toBe('not_configured')
    // Une porte fermée ne dit rien de l'activité des agents déployés.
    expect(posture.telemetryIngestion.message).toMatch(/ne dit rien de l’activité/i)
  })

  it('est configurée quand le jeton est présent, sans jamais en révéler la valeur', async () => {
    process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN = TEST_TOKEN
    const posture = await getSettingsPostureSnapshot()

    expect(posture.telemetryIngestion.status).toBe('configured')
    expect(JSON.stringify(posture)).not.toContain(TEST_TOKEN)
  })

  it('n’entre pas dans l’agrégat global — un opt-in absent ne dégrade pas la posture', async () => {
    const withoutToken = await getSettingsPostureSnapshot()
    process.env.AIGENT_RUNTIME_TELEMETRY_TOKEN = TEST_TOKEN
    const withToken = await getSettingsPostureSnapshot()

    expect(withToken.status).toBe(withoutToken.status)
  })
})

describe('posture — plafonds de coût', () => {
  it('déclare le plafond par run comme null, jamais 0', async () => {
    const posture = await getSettingsPostureSnapshot()

    const perRun = posture.costLimits.items.find((item) => item.unit === 'usd_per_run')
    expect(perRun).toBeDefined()
    // `null` = « défini ailleurs, par agent ». `0` voudrait dire « aucun appel
    // facturé autorisé » — l'inverse exact de ce qui est vrai.
    expect(perRun?.limitUsd).toBeNull()
    expect(perRun?.limitUsd).not.toBe(0)
    expect(perRun?.source).toContain('max_cost_per_run_usd')
  })

  it('expose le budget de boucle comme un nombre strictement positif', async () => {
    const posture = await getSettingsPostureSnapshot()

    const perLoop = posture.costLimits.items.find((item) => item.unit === 'usd_per_loop')
    expect(perLoop?.limitUsd).toBeGreaterThan(0)
    expect(perLoop?.enforced).toBe(true)
  })
})
