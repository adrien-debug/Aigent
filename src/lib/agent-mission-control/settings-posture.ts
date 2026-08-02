import 'server-only'

import { authConfigured } from './auth'
import { getLearningRuntimeHealth } from './learning-runtime'
import { resolveAgentServerUrl } from '@/langgraph/agent-server-endpoint.mjs'

export type SettingsConfigStatus = 'configured' | 'partial' | 'unavailable' | 'not_configured'

export interface SettingsPostureSignal {
  status: SettingsConfigStatus
  message: string
  provenance: string
  endpoint: string | null
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
}

const BACKEND_PROBE_TIMEOUT_MS = 2_000
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

export async function getSettingsPostureSnapshot(): Promise<SettingsPostureSnapshot> {
  const checkedAt = new Date().toISOString()
  const operatorAuth = operatorAuthSignal()
  const backendGpu1 = await backendGpu1Signal()
  const langgraph = langgraphSignal()
  const providers = providerSignals()
  const observability = observabilitySignals()
  const githubShipping = githubShippingSignal(backendGpu1.status)
  const learningRuntime = await learningRuntimeSignal()

  const status = normalizeStatus([
    operatorAuth.status,
    backendGpu1.status,
    langgraph.status,
    providers.status,
    observability.status,
    githubShipping.status,
    learningRuntime.status,
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
  }
}
