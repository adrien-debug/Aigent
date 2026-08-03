import 'server-only'

import { authConfigured } from './auth'
import { getLearningRuntimeHealth } from './learning-runtime'
import { RUNTIME_IDS, RUNTIME_REGISTRY } from './registry'
import { resolveAgentServerUrl } from '@/langgraph/agent-server-endpoint.mjs'

export type SettingsConfigStatus = 'configured' | 'partial' | 'unavailable' | 'not_configured'

export interface SettingsPostureSignal {
  status: SettingsConfigStatus
  message: string
  provenance: string
  endpoint: string | null
}

/**
 * Le runtime réellement exécutable, lu depuis le registre canonique — jamais une
 * constante recopiée. Un identifiant déclaré sans moteur n'est PAS un runtime
 * actif : il est listé pour que l'opérateur sache qu'il existe et qu'il ne
 * s'exécutera pas.
 */
export interface SettingsRuntimeSignal {
  id: string
  label: string
  engine: string
  executable: boolean
  creatable: boolean
  note: string
}

/**
 * Plafonds de coût — ce qu'Aigent applique RÉELLEMENT, et où ils sont définis.
 *
 * Volontairement pas de chiffre par agent ici : le plafond par run vit dans le
 * manifeste de chaque agent (`manifests.max_cost_per_run_usd`), pas dans une
 * configuration globale. Prétendre le contraire depuis /settings ferait croire
 * à un réglage global qui n'existe pas.
 */
export interface SettingsCostLimit {
  scope: string
  /** `null` = aucun plafond global défini à ce niveau ; jamais coercé en 0. */
  limitUsd: number | null
  unit: 'usd_per_run' | 'usd_per_loop'
  enforced: boolean
  source: string
  detail: string
}

export interface SettingsProviderSignal {
  provider: 'openai' | 'google' | 'local' | 'mistral'
  status: SettingsConfigStatus
  executable: boolean
  configured: boolean
  message: string
  provenance: string
}

export interface SettingsPostureSnapshot {
  status: SettingsConfigStatus
  checkedAt: string
  message: string
  operatorAuth: SettingsPostureSignal
  backendGpu1: SettingsPostureSignal
  langgraph: SettingsPostureSignal
  providers: {
    status: SettingsConfigStatus
    message: string
    provenance: string
    items: SettingsProviderSignal[]
  }
  observability: {
    status: SettingsConfigStatus
    message: string
    provenance: string
    langsmith: SettingsPostureSignal
    langfuse: SettingsPostureSignal
  }
  githubShipping: SettingsPostureSignal
  learningRuntime: SettingsPostureSignal & {
    capabilities: string[] | null
  }
  /** Le plan d'exécution : quel runtime exécute vraiment, quels ids sont inertes. */
  runtimes: {
    status: SettingsConfigStatus
    message: string
    provenance: string
    /** L'unique runtime exécutable, ou `null` si le registre n'en déclare aucun. */
    active: SettingsRuntimeSignal | null
    items: SettingsRuntimeSignal[]
  }
  /** Ingestion de télémétrie côté Aigent — la porte d'entrée, pas le trafic. */
  telemetryIngestion: SettingsPostureSignal
  /** Plafonds de coût réellement appliqués, et leur niveau de définition. */
  costLimits: {
    status: SettingsConfigStatus
    message: string
    provenance: string
    items: SettingsCostLimit[]
  }
}

const BACKEND_PROBE_TIMEOUT_MS = 2_000

/**
 * Miroir du plafond par défaut de la boucle d'amélioration autonome.
 *
 * `improvement-loop.ts` ne l'exporte pas et n'appartient pas au périmètre de
 * cette mission : la valeur est recopiée ici plutôt que d'importer le module
 * entier (qui tire des chemins d'écriture) pour un seul nombre. Le rendu nomme
 * explicitement sa source, donc un écart se voit à la lecture.
 */
const AUTO_IMPROVE_MAX_COST_USD = 2.0
const LOCAL_VLLM_URL_ENV_KEYS = [
  'VLLM_GPU1_REASONING_URL',
  'VLLM_GPU2_LLAMA_URL',
  'VLLM_GPU1_QWEN32_URL',
  'VLLM_GPU1_QWEN7_URL',
] as const

function normalizeStatus(statuses: SettingsConfigStatus[]): SettingsConfigStatus {
  if (statuses.some((status) => status === 'unavailable')) return 'unavailable'
  if (statuses.some((status) => status === 'partial')) return 'partial'
  const configuredCount = statuses.filter((status) => status === 'configured').length
  const notConfiguredCount = statuses.filter((status) => status === 'not_configured').length
  if (configuredCount > 0 && notConfiguredCount > 0) return 'partial'
  if (configuredCount > 0) return 'configured'
  return 'not_configured'
}

function sanitizeEndpoint(input: string | null | undefined): string | null {
  if (!input) return null
  try {
    const url = new URL(input)
    url.username = ''
    url.password = ''
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return null
  }
}

function envHasValue(key: string): boolean {
  const value = process.env[key]
  return typeof value === 'string' && value.trim().length > 0
}

function operatorAuthSignal(): SettingsPostureSignal {
  const configured = authConfigured()
  const production = process.env.NODE_ENV === 'production'
  if (configured) {
    return {
      status: 'configured',
      message: 'Session HMAC et mot de passe admin configurés.',
      provenance: 'authConfigured()',
      endpoint: null,
    }
  }
  return {
    status: 'not_configured',
    message: production
      ? "Configuration auth absente : en production, l'accès opérateur reste fail-closed."
      : "Configuration auth absente : la surface opérateur reste inaccessible tant que les variables AMC_* ne sont pas complètes.",
    provenance: 'authConfigured()',
    endpoint: null,
  }
}

async function backendGpu1Signal(): Promise<SettingsPostureSignal> {
  const source = process.env.AMC_DATA_SOURCE
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (source !== 'gpu1' || !base || !key) {
    return {
      status: 'not_configured',
      message: 'Backend GPU1 incomplet : AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis.',
      provenance: 'env',
      endpoint: sanitizeEndpoint(base),
    }
  }

  const probeUrl = `${base.replace(/\/+$/, '')}/rest/v1/projects?select=id&limit=1`
  try {
    const response = await fetch(probeUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(BACKEND_PROBE_TIMEOUT_MS),
    })
    if (!response.ok) {
      return {
        status: 'unavailable',
        message: `Backend GPU1 configuré mais indisponible (HTTP ${response.status} sur la sonde PostgREST).`,
        provenance: 'env + probe',
        endpoint: sanitizeEndpoint(base),
      }
    }
    return {
      status: 'configured',
      message: 'Backend GPU1 configuré et joignable.',
      provenance: 'env + probe',
      endpoint: sanitizeEndpoint(base),
    }
  } catch (err) {
    const timeout = err instanceof Error && err.name === 'TimeoutError'
    return {
      status: 'unavailable',
      message: timeout
        ? `Backend GPU1 configuré mais la sonde a expiré après ${BACKEND_PROBE_TIMEOUT_MS}ms.`
        : 'Backend GPU1 configuré mais injoignable (erreur réseau).',
      provenance: 'env + probe',
      endpoint: sanitizeEndpoint(base),
    }
  }
}

function langgraphSignal(): SettingsPostureSignal {
  const hasSecret = envHasValue('LANGGRAPH_SERVER_SECRET')
  let endpoint: string | null = null

  try {
    endpoint = sanitizeEndpoint(resolveAgentServerUrl(process.env))
  } catch (err) {
    const message = err instanceof Error ? err.message : 'configuration invalide'
    return {
      status: 'unavailable',
      message: `Configuration LangGraph invalide: ${message}.`,
      provenance: 'resolveAgentServerUrl(env)',
      endpoint: null,
    }
  }

  if (!hasSecret) {
    return {
      status: 'partial',
      message: 'Endpoint LangGraph résolu, mais LANGGRAPH_SERVER_SECRET est absent : les appels agent-server échoueront.',
      provenance: 'env + resolveAgentServerUrl(env)',
      endpoint,
    }
  }

  return {
    status: 'configured',
    message: 'Endpoint LangGraph et secret serveur configurés.',
    provenance: 'env + resolveAgentServerUrl(env)',
    endpoint,
  }
}

function providerSignals(): SettingsPostureSnapshot['providers'] {
  const openaiConfigured = envHasValue('OPENAI_API_KEY')
  const googleConfigured = envHasValue('GEMINI_API_KEY') || envHasValue('GOOGLE_API_KEY')
  const hasLocalKey = envHasValue('VLLM_LOCAL_API_KEY')
  const hasLocalEndpoint = LOCAL_VLLM_URL_ENV_KEYS.some((key) => envHasValue(key))

  const localStatus: SettingsConfigStatus =
    hasLocalKey && hasLocalEndpoint ? 'configured' : hasLocalKey || hasLocalEndpoint ? 'partial' : 'not_configured'

  const items: SettingsProviderSignal[] = [
    {
      provider: 'openai',
      status: openaiConfigured ? 'configured' : 'not_configured',
      executable: true,
      configured: openaiConfigured,
      message: openaiConfigured
        ? 'Provider exécutable et clé présente.'
        : 'Provider exécutable mais OPENAI_API_KEY absent.',
      provenance: 'env',
    },
    {
      provider: 'google',
      status: googleConfigured ? 'configured' : 'not_configured',
      executable: true,
      configured: googleConfigured,
      message: googleConfigured
        ? 'Provider exécutable et clé Gemini présente.'
        : 'Provider exécutable mais GEMINI_API_KEY/GOOGLE_API_KEY absent.',
      provenance: 'env',
    },
    {
      provider: 'local',
      status: localStatus,
      executable: true,
      configured: localStatus === 'configured',
      message:
        localStatus === 'configured'
          ? 'Provider exécutable (vLLM local) avec clé et endpoint(s).'
          : localStatus === 'partial'
            ? 'Provider local partiel : clé ou endpoint(s) manquant(s).'
            : 'Provider local non configuré.',
      provenance: 'env',
    },
    {
      provider: 'mistral',
      status: 'unavailable',
      executable: false,
      configured: false,
      message: "Provider déclaré mais non câblé : `mistral` n'est pas exécutable dans ce runtime.",
      provenance: 'src/langgraph/model-provider.mjs + model-router',
    },
  ]

  const blockingItems = items.filter((item) => item.provider !== 'mistral')
  const status = normalizeStatus(blockingItems.map((item) => item.status))
  return {
    status,
    message:
      status === 'configured'
        ? 'Au moins un provider exécutable est prêt.'
        : status === 'partial'
          ? 'Providers exécutables partiellement configurés.'
          : status === 'not_configured'
            ? 'Aucun provider exécutable configuré.'
            : 'Providers exécutables indisponibles.',
    provenance: 'env + code',
    items,
  }
}

function langsmithSignal(): SettingsPostureSignal {
  const hasKey = envHasValue('LANGSMITH_API_KEY')
  const endpoint = sanitizeEndpoint(process.env.LANGSMITH_ENDPOINT ?? 'https://api.smith.langchain.com')
  const hasTraceBase = envHasValue('LANGSMITH_TRACE_BASE_URL')
  if (!hasKey) {
    return {
      status: 'not_configured',
      message: 'Export LangSmith inactif : LANGSMITH_API_KEY absent.',
      provenance: 'env',
      endpoint: null,
    }
  }
  if (!hasTraceBase) {
    return {
      status: 'partial',
      message: 'Export LangSmith actif, mais aucun lien profond configuré (LANGSMITH_TRACE_BASE_URL absent).',
      provenance: 'env',
      endpoint,
    }
  }
  return {
    status: 'configured',
    message: 'Export LangSmith et deep-links configurés.',
    provenance: 'env',
    endpoint,
  }
}

function langfuseSignal(): SettingsPostureSignal {
  const host = process.env.LANGFUSE_HOST
  const hasHost = envHasValue('LANGFUSE_HOST')
  const hasPublic = envHasValue('LANGFUSE_PUBLIC_KEY')
  const hasSecret = envHasValue('LANGFUSE_SECRET_KEY')
  const configuredCount = [hasHost, hasPublic, hasSecret].filter(Boolean).length

  if (configuredCount === 0) {
    return {
      status: 'not_configured',
      message: 'Export Langfuse inactif : variables LANGFUSE_* absentes.',
      provenance: 'env',
      endpoint: null,
    }
  }
  if (configuredCount < 3) {
    return {
      status: 'partial',
      message: 'Export Langfuse partiel : host/public/secret doivent être tous présents.',
      provenance: 'env',
      endpoint: sanitizeEndpoint(host),
    }
  }
  return {
    status: 'configured',
    message: 'Export Langfuse configuré.',
    provenance: 'env',
    endpoint: sanitizeEndpoint(host),
  }
}

function observabilitySignals(): SettingsPostureSnapshot['observability'] {
  const langsmith = langsmithSignal()
  const langfuse = langfuseSignal()
  const status = normalizeStatus([langsmith.status, langfuse.status])
  return {
    status,
    message:
      status === 'configured'
        ? 'Observabilité configurée.'
        : status === 'partial'
          ? 'Observabilité partielle.'
          : status === 'not_configured'
            ? 'Observabilité non configurée.'
            : 'Observabilité indisponible.',
    provenance: 'env',
    langsmith,
    langfuse,
  }
}

function githubShippingSignal(backendStatus: SettingsConfigStatus): SettingsPostureSignal {
  const hasToken = envHasValue('GITHUB_TOKEN')
  const pushArmed = process.env.GITHUB_PUSH_ENABLED === '1'
  if (!hasToken) {
    return {
      status: 'not_configured',
      message: 'Shipping GitHub en dry-run forcé : GITHUB_TOKEN absent.',
      provenance: 'env',
      endpoint: 'https://api.github.com',
    }
  }
  if (!pushArmed || backendStatus !== 'configured') {
    return {
      status: 'partial',
      message: !pushArmed
        ? "GitHub configuré mais écriture distante désarmée (GITHUB_PUSH_ENABLED !== '1')."
        : 'GitHub configuré mais backend GPU1 non confirmé joignable pour un push réel.',
      provenance: 'env + backend probe',
      endpoint: 'https://api.github.com',
    }
  }
  return {
    status: 'configured',
    message: 'Shipping GitHub armé pour un push réel (confirm + flag).',
    provenance: 'env + backend probe',
    endpoint: 'https://api.github.com',
  }
}

async function learningRuntimeSignal(): Promise<SettingsPostureSnapshot['learningRuntime']> {
  const health = await getLearningRuntimeHealth()
  const mapped: SettingsConfigStatus =
    health.status === 'live'
      ? 'configured'
      : health.status === 'partial'
        ? 'partial'
        : health.status === 'unavailable'
          ? 'unavailable'
          : 'not_configured'
  return {
    status: mapped,
    message: health.detail ?? 'Learning runtime live.',
    provenance: 'getLearningRuntimeHealth()',
    endpoint: sanitizeEndpoint(health.endpoint),
    capabilities: health.capabilities,
  }
}

/**
 * Le plan d'exécution, lu depuis le registre canonique.
 *
 * `active` n'est pas une constante : c'est l'unique entrée dont le moteur n'est
 * pas `none`. Si le registre en déclarait deux, `partial` le dirait — plutôt que
 * d'en élire un arbitrairement.
 */
function runtimeSignals(): SettingsPostureSnapshot['runtimes'] {
  const items: SettingsRuntimeSignal[] = RUNTIME_IDS.map((id) => {
    const definition = RUNTIME_REGISTRY[id]
    return {
      id: definition.id,
      label: definition.label,
      engine: definition.engine,
      executable: definition.engine !== 'none',
      creatable: definition.creatable && definition.engine !== 'none',
      note: definition.note,
    }
  })

  const executable = items.filter((item) => item.executable)

  if (executable.length === 0) {
    return {
      status: 'not_configured',
      message: "Aucun runtime exécutable dans le registre : aucun agent ne peut s'exécuter.",
      provenance: 'RUNTIME_REGISTRY',
      active: null,
      items,
    }
  }

  if (executable.length > 1) {
    return {
      status: 'partial',
      message: `${executable.length} runtimes exécutables déclarés : le runtime actif n'est pas unique.`,
      provenance: 'RUNTIME_REGISTRY',
      active: null,
      items,
    }
  }

  return {
    status: 'configured',
    message: `Runtime actif : ${executable[0].label} (moteur ${executable[0].engine}).`,
    provenance: 'RUNTIME_REGISTRY',
    active: executable[0],
    items,
  }
}

/**
 * Ingestion de télémétrie côté Aigent — le niveau 3 de la boucle.
 *
 * Ce signal dit UNIQUEMENT si la porte est ouverte. Il ne dit rien du trafic
 * reçu ni de l'activité des agents déployés : confondre les deux ferait lire
 * « aucun événement » comme « aucun agent ne tourne », ce qui est faux.
 */
function telemetryIngestionSignal(): SettingsPostureSignal {
  const configured = envHasValue('AIGENT_RUNTIME_TELEMETRY_TOKEN')
  return {
    status: configured ? 'configured' : 'not_configured',
    message: configured
      ? "Ingestion de télémétrie ouverte : un agent déployé peut rapporter ses runs. Ce signal ne dit rien du trafic réellement reçu."
      : 'Ingestion de télémétrie fermée : POST /api/runtime-telemetry répond 503 à tout agent. Cela ne dit rien de l’activité des agents déployés.',
    provenance: 'env',
    endpoint: '/api/runtime-telemetry',
  }
}

/**
 * Les plafonds de coût réellement appliqués.
 *
 * `limitUsd: null` sur le plafond par run est un FAIT, pas une absence de
 * mesure côté lecture : il n'existe aucun plafond global par run dans cette
 * configuration — chaque agent porte le sien dans son manifeste. Afficher un
 * chiffre ici inventerait un réglage global.
 */
function costLimitSignals(): SettingsPostureSnapshot['costLimits'] {
  const items: SettingsCostLimit[] = [
    {
      scope: 'Plafond par run',
      limitUsd: null,
      unit: 'usd_per_run',
      enforced: true,
      source: 'manifests.max_cost_per_run_usd',
      detail:
        "Défini par agent dans son manifeste, pas globalement. Vérifié avant chaque appel facturé sur les deux chemins d'exécution ; un manifeste sans plafond signifie run non borné.",
    },
    {
      scope: "Budget d'une boucle d'amélioration",
      limitUsd: AUTO_IMPROVE_MAX_COST_USD,
      unit: 'usd_per_loop',
      enforced: true,
      source: 'improvement-loop (constante du code)',
      detail:
        "Plafond cumulé d'une boucle autonome, surchargeable par appel. Constante du code — aucune variable d'environnement ne le règle.",
    },
  ]

  return {
    status: 'configured',
    message: 'Plafonds appliqués au niveau du manifeste et de la boucle, jamais par variable globale.',
    provenance: 'code',
    items,
  }
}

export async function getSettingsPostureSnapshot(): Promise<SettingsPostureSnapshot> {
  const checkedAt = new Date().toISOString()
  const operatorAuth = operatorAuthSignal()
  const backendGpu1 = await backendGpu1Signal()
  const langgraph = langgraphSignal()
  const providers = providerSignals()
  const observability = observabilitySignals()
  const githubShipping = githubShippingSignal(backendGpu1.status)
  const learningRuntime = await learningRuntimeSignal()
  const runtimes = runtimeSignals()
  const telemetryIngestion = telemetryIngestionSignal()
  const costLimits = costLimitSignals()

  // `telemetryIngestion` et `costLimits` sont RENDUS mais n'entrent pas dans
  // l'agrégat : le premier est un opt-in légitime (une installation sans agent
  // déployé n'a aucune raison d'ouvrir l'ingestion, et la dégrader ferait lire
  // une posture saine comme incomplète), le second n'est pas une configuration
  // d'environnement. La composition de l'agrégat reste donc celle du contrat
  // existant, `runtimes` excepté — lui décrit bien une capacité d'exécution.
  const status = normalizeStatus([
    operatorAuth.status,
    backendGpu1.status,
    langgraph.status,
    providers.status,
    observability.status,
    githubShipping.status,
    learningRuntime.status,
    runtimes.status,
  ])

  const message =
    status === 'configured'
      ? 'Configuration opérateur complète.'
      : status === 'partial'
        ? 'Configuration opérateur partielle : au moins une capacité reste incomplète.'
        : status === 'not_configured'
          ? 'Configuration opérateur absente.'
          : 'Configuration opérateur indisponible : une dépendance configurée ne répond pas.'

  return {
    status,
    checkedAt,
    message,
    operatorAuth,
    backendGpu1,
    langgraph,
    providers,
    observability,
    githubShipping,
    learningRuntime,
    runtimes,
    telemetryIngestion,
    costLimits,
  }
}
