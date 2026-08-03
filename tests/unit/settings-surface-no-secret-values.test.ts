/**
 * La garde la plus importante de la surface Réglages : AUCUNE VALEUR DE SECRET
 * NE PEUT ÊTRE RENDUE.
 *
 * Deux preuves complémentaires, parce qu'aucune ne suffit seule :
 *
 *  1. UNE PREUVE DE DONNÉE. On peuple l'environnement de valeurs sentinelles
 *     reconnaissables — y compris dans les endroits où un secret se cache dans
 *     une URL (identifiant, mot de passe, query) — puis on sérialise le snapshot
 *     que la page reçoit et on vérifie qu'aucune sentinelle n'y survit, ni
 *     entière, ni tronquée. Le contrôle du tronqué est ce qui distingue cette
 *     garde d'un simple `not.toContain` : un masque `sk-abc…` passerait le
 *     second et pas le premier.
 *
 *  2. UNE PREUVE DE CODE. Les composants de rendu ne lisent JAMAIS
 *     `process.env`. C'est la garantie structurelle : même si le contrat serveur
 *     régressait, la surface ne pourrait pas aller chercher une valeur
 *     elle-même. Un test de données seul ne couvre pas ce chemin.
 *
 * Il n'existe pas de test de RENDU dans ce dépôt (environnement vitest `node`,
 * pas de DOM) : ces deux gardes couvrent la donnée et le code, pas les pixels.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getLearningRuntimeHealth = vi.fn()
vi.mock('@/lib/agent-mission-control/learning-runtime', () => ({
  getLearningRuntimeHealth: () => getLearningRuntimeHealth(),
}))

const { getSettingsPostureSnapshot } = await import('@/lib/agent-mission-control/settings-posture')

const ROOT = process.cwd()
const SURFACE_FILES = [
  'src/app/settings/page.tsx',
  'src/components/settings/settings-screen.tsx',
  'src/components/settings/atoms.tsx',
]

/**
 * Le CODE d'un fichier, ses commentaires retirés.
 *
 * Sans ça, la garde se déclencherait sur une prose qui explique justement
 * pourquoi la surface ne lit pas l'environnement — un faux rouge qui pousserait
 * à supprimer la documentation plutôt qu'à corriger du code. On mesure ce qui
 * s'exécute.
 */
function codeOf(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * Des valeurs sentinelles qui ne ressemblent à rien d'autre dans le payload.
 * Chacune est assez longue pour qu'un préfixe de 8 caractères soit lui aussi
 * une signature — c'est ce qui rend le test de fuite partielle possible.
 */
const SECRETS: Record<string, string> = {
  SUPABASE_SERVICE_ROLE_KEY: 'ZZSERVICEROLEZZ-0000000000000000',
  AMC_SESSION_SECRET: 'ZZSESSIONSECRETZZ-11111111111111',
  AMC_ADMIN_PASSWORD: 'ZZADMINPASSWORDZZ-2222222222222',
  LANGGRAPH_SERVER_SECRET: 'ZZLANGGRAPHSECRETZZ-333333333333',
  OPENAI_API_KEY: 'ZZOPENAIKEYZZ-44444444444444444',
  GEMINI_API_KEY: 'ZZGEMINIKEYZZ-55555555555555555',
  GOOGLE_API_KEY: 'ZZGOOGLEKEYZZ-66666666666666666',
  VLLM_LOCAL_API_KEY: 'ZZVLLMKEYZZ-7777777777777777777',
  LANGSMITH_API_KEY: 'ZZLANGSMITHKEYZZ-888888888888888',
  LANGFUSE_PUBLIC_KEY: 'ZZLANGFUSEPUBZZ-99999999999999',
  LANGFUSE_SECRET_KEY: 'ZZLANGFUSESECZZ-aaaaaaaaaaaaaa',
  GITHUB_TOKEN: 'ZZGITHUBTOKENZZ-bbbbbbbbbbbbbb',
  AIGENT_RUNTIME_TELEMETRY_TOKEN: 'ZZTELEMETRYTOKENZZ-cccccccccccc',
  AMC_API_KEY: 'ZZAMCAPIKEYZZ-dddddddddddddddd',
}

const NON_SECRET_ENV: Record<string, string> = {
  AMC_DATA_SOURCE: 'gpu1',
  // Le pire cas : un secret glissé dans l'identifiant, le mot de passe ET la
  // query d'une URL qui, elle, est légitimement affichable.
  AMC_SUPABASE_URL:
    'https://ZZSERVICEROLEZZ-0000000000000000:ZZADMINPASSWORDZZ-2222222222222@postgres.internal.example:5432/aigent?apikey=ZZSERVICEROLEZZ-0000000000000000',
  LANGGRAPH_API_URL: 'http://127.0.0.1:2024',
  LANGSMITH_ENDPOINT: 'https://api.smith.langchain.com',
  LANGSMITH_TRACE_BASE_URL: 'https://smith.langchain.com/o/org/projects/p/proj/r',
  LANGFUSE_HOST: 'https://ZZLANGFUSEPUBZZ-99999999999999@langfuse.internal.example',
  VLLM_GPU1_REASONING_URL: 'http://10.10.10.10:8000',
  GITHUB_PUSH_ENABLED: '1',
}

const ALL_KEYS = [...Object.keys(SECRETS), ...Object.keys(NON_SECRET_ENV)]
const saved: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of ALL_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  vi.unstubAllEnvs()
  vi.stubEnv('NODE_ENV', 'development')
  for (const [key, value] of Object.entries(SECRETS)) process.env[key] = value
  for (const [key, value] of Object.entries(NON_SECRET_ENV)) process.env[key] = value

  getLearningRuntimeHealth.mockReset()
  getLearningRuntimeHealth.mockResolvedValue({
    status: 'live',
    checkedAt: '2026-08-03T00:00:00.000Z',
    // Un secret glissé jusque dans l'endpoint retourné par une dépendance.
    endpoint: 'https://ZZAMCAPIKEYZZ-dddddddddddddddd@learning.internal.example',
    capabilities: ['train'],
    detail: null,
    latencyMs: 8,
  })

  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ ok: true }),
  } as Response) as unknown as typeof fetch
})

afterEach(() => {
  for (const key of ALL_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('surface Réglages — aucune valeur de secret', () => {
  it('ne laisse aucune valeur de secret dans le snapshot rendu par la page', async () => {
    const posture = await getSettingsPostureSnapshot()
    const serialized = JSON.stringify(posture)

    for (const [key, value] of Object.entries(SECRETS)) {
      expect(serialized, `valeur complète de ${key} présente dans le payload`).not.toContain(value)
    }
  })

  it('ne laisse fuiter aucun PRÉFIXE de secret — un masque partiel est une fuite', async () => {
    const posture = await getSettingsPostureSnapshot()
    const serialized = JSON.stringify(posture)

    for (const [key, value] of Object.entries(SECRETS)) {
      // 8 caractères : assez pour identifier la sentinelle, assez court pour
      // attraper un `sk-abcd…` que le test de valeur complète laisserait passer.
      const prefix = value.slice(0, 8)
      expect(serialized, `préfixe de ${key} présent dans le payload`).not.toContain(prefix)
    }
  })

  it('assainit les endpoints sans perdre leur cible affichable', async () => {
    const posture = await getSettingsPostureSnapshot()

    // La cible reste utile à l'opérateur : l'hôte survit, les credentials non.
    expect(posture.backendGpu1.endpoint).toBe('https://postgres.internal.example:5432/aigent')
    expect(posture.observability.langfuse.endpoint).toBe('https://langfuse.internal.example')
    expect(posture.learningRuntime.endpoint).toBe('https://learning.internal.example')
  })

  it('expose la présence d’un identifiant comme un BOOLÉEN, jamais comme une valeur', async () => {
    const posture = await getSettingsPostureSnapshot()

    const openai = posture.providers.items.find((item) => item.provider === 'openai')
    expect(openai?.configured).toBe(true)
    expect(typeof openai?.configured).toBe('boolean')

    delete process.env.OPENAI_API_KEY
    const withoutKey = await getSettingsPostureSnapshot()
    const openaiAbsent = withoutKey.providers.items.find((item) => item.provider === 'openai')

    // Absent ⇒ NON CONFIGURÉ explicite. Jamais « OK par omission », jamais un
    // faux zéro, jamais un défaut fabriqué.
    expect(openaiAbsent?.configured).toBe(false)
    expect(openaiAbsent?.status).toBe('not_configured')
    // Câblé reste vrai : la clé manque, le code existe. Les deux faits restent
    // distincts.
    expect(openaiAbsent?.executable).toBe(true)
  })

  it('les composants de la surface ne lisent jamais process.env', () => {
    for (const relPath of SURFACE_FILES) {
      expect(codeOf(relPath), `${relPath} lit process.env`).not.toMatch(/process\s*\.\s*env/)
    }
  })

  it('la surface n’expose aucun chemin d’écriture', () => {
    for (const relPath of SURFACE_FILES) {
      const source = codeOf(relPath)
      // Lecture seule : ni formulaire, ni soumission, ni mutation réseau.
      expect(source, `${relPath} contient un <form>`).not.toMatch(/<form[\s>]/)
      expect(source, `${relPath} contient un <input>`).not.toMatch(/<input[\s>]/)
      expect(source, `${relPath} contient un onSubmit`).not.toMatch(/onSubmit/)
      expect(source, `${relPath} contient un onClick`).not.toMatch(/onClick/)
      expect(source, `${relPath} fait un appel réseau`).not.toMatch(/\bfetch\s*\(/)
      expect(source, `${relPath} déclare une server action`).not.toMatch(/['"]use server['"]/)
      expect(source, `${relPath} utilise une méthode mutante`).not.toMatch(
        /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/i,
      )
    }
  })
})
