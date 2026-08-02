import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const getLearningRuntimeHealth = vi.fn()
vi.mock('@/lib/agent-mission-control/learning-runtime', () => ({
  getLearningRuntimeHealth: () => getLearningRuntimeHealth(),
}))

const { getSettingsPostureSnapshot } = await import('@/lib/agent-mission-control/settings-posture')

const originalFetch = global.fetch

const ENV_KEYS = [
  'AMC_DATA_SOURCE',
  'AMC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AMC_SESSION_SECRET',
  'AMC_ADMIN_PASSWORD',
  'AMC_ADMIN_PASSWORD_HASH',
  'LANGGRAPH_API_URL',
  'LANGGRAPH_SERVER_SECRET',
  'OPENAI_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'VLLM_LOCAL_API_KEY',
  'VLLM_GPU1_REASONING_URL',
  'VLLM_GPU2_LLAMA_URL',
  'VLLM_GPU1_QWEN32_URL',
  'VLLM_GPU1_QWEN7_URL',
  'LANGSMITH_API_KEY',
  'LANGSMITH_ENDPOINT',
  'LANGSMITH_TRACE_BASE_URL',
  'LANGFUSE_HOST',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'GITHUB_TOKEN',
  'GITHUB_PUSH_ENABLED',
] as const

type EnvKey = (typeof ENV_KEYS)[number]

const saved: Partial<Record<EnvKey, string | undefined>> = {}

function jsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ ok: true }),
  } as Response
}

function setFullConfig(): void {
  vi.stubEnv('NODE_ENV', 'development')
  process.env.AMC_DATA_SOURCE = 'gpu1'
  process.env.AMC_SUPABASE_URL = 'https://postgres.internal.example'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-super-secret'
  process.env.AMC_SESSION_SECRET = 'session-secret-very-long'
  process.env.AMC_ADMIN_PASSWORD = 'admin-password'
  process.env.LANGGRAPH_SERVER_SECRET = 'langgraph-secret'
  process.env.OPENAI_API_KEY = 'openai-secret'
  process.env.GEMINI_API_KEY = 'gemini-secret'
  process.env.VLLM_LOCAL_API_KEY = 'vllm-secret'
  process.env.VLLM_GPU1_REASONING_URL = 'http://10.10.10.10:8000'
  process.env.LANGSMITH_API_KEY = 'ls-secret'
  process.env.LANGSMITH_TRACE_BASE_URL = 'https://smith.langchain.com/o/org/projects/p/project/r'
  process.env.LANGFUSE_HOST = 'https://langfuse.internal.example'
  process.env.LANGFUSE_PUBLIC_KEY = 'lf-public'
  process.env.LANGFUSE_SECRET_KEY = 'lf-secret'
  process.env.GITHUB_TOKEN = 'gh-secret'
  process.env.GITHUB_PUSH_ENABLED = '1'
}

beforeEach(() => {
  ENV_KEYS.forEach((key) => {
    saved[key] = process.env[key]
    delete process.env[key]
  })
  vi.unstubAllEnvs()
  getLearningRuntimeHealth.mockReset()
  global.fetch = vi.fn().mockResolvedValue(jsonResponse(200)) as unknown as typeof fetch
})

afterEach(() => {
  ENV_KEYS.forEach((key) => {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  })
  vi.unstubAllEnvs()
  global.fetch = originalFetch
  vi.restoreAllMocks()
})

describe('getSettingsPostureSnapshot', () => {
  it('returns configured when every mandatory signal is healthy', async () => {
    setFullConfig()
    getLearningRuntimeHealth.mockResolvedValue({
      status: 'live',
      checkedAt: '2026-08-02T00:00:00.000Z',
      endpoint: 'https://learning.internal.example',
      capabilities: ['train', 'evaluate'],
      detail: null,
      latencyMs: 10,
    })

    const posture = await getSettingsPostureSnapshot()

    expect(posture.status).toBe('configured')
    expect(posture.backendGpu1.status).toBe('configured')
    expect(posture.providers.status).toBe('configured')
    expect(posture.learningRuntime.status).toBe('configured')
    expect(posture.providers.items.find((item) => item.provider === 'mistral')?.status).toBe('unavailable')
  })

  it('returns partial when configuration is incomplete', async () => {
    setFullConfig()
    delete process.env.VLLM_LOCAL_API_KEY
    process.env.VLLM_GPU1_QWEN32_URL = 'http://10.10.10.11:8000'
    process.env.GITHUB_PUSH_ENABLED = '0'
    getLearningRuntimeHealth.mockResolvedValue({
      status: 'partial',
      checkedAt: '2026-08-02T00:00:00.000Z',
      endpoint: 'https://learning.internal.example',
      capabilities: null,
      detail: 'payload incomplete',
      latencyMs: 12,
    })

    const posture = await getSettingsPostureSnapshot()

    expect(posture.status).toBe('partial')
    expect(posture.providers.items.find((item) => item.provider === 'local')?.status).toBe('partial')
    expect(posture.githubShipping.status).toBe('partial')
    expect(posture.learningRuntime.status).toBe('partial')
  })

  it('never leaks secret values in the serialized payload', async () => {
    setFullConfig()
    process.env.AMC_SUPABASE_URL = 'https://service-role-super-secret:db-password@postgres.internal.example:5432/aigent?sslmode=require'
    process.env.LANGFUSE_HOST = 'https://lf-public:lf-secret@langfuse.internal.example'
    getLearningRuntimeHealth.mockResolvedValue({
      status: 'not_configured',
      checkedAt: '2026-08-02T00:00:00.000Z',
      endpoint: null,
      capabilities: null,
      detail: 'not configured',
      latencyMs: null,
    })

    const posture = await getSettingsPostureSnapshot()
    const serialized = JSON.stringify(posture)

    expect(serialized).not.toContain('service-role-super-secret')
    expect(serialized).not.toContain('db-password')
    expect(serialized).not.toContain('lf-secret')
    expect(posture.backendGpu1.endpoint).toBe('https://postgres.internal.example:5432/aigent')
    expect(posture.observability.langfuse.endpoint).toBe('https://langfuse.internal.example')
  })

  it('marks backend as unavailable when probe fails while env is configured', async () => {
    setFullConfig()
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(503)) as unknown as typeof fetch
    getLearningRuntimeHealth.mockResolvedValue({
      status: 'live',
      checkedAt: '2026-08-02T00:00:00.000Z',
      endpoint: 'https://learning.internal.example',
      capabilities: ['train'],
      detail: null,
      latencyMs: 12,
    })

    const posture = await getSettingsPostureSnapshot()

    expect(posture.backendGpu1.status).toBe('unavailable')
    expect(posture.backendGpu1.message).toContain('HTTP 503')
  })

  it('keeps operator auth fail-closed in production when secrets are missing', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    process.env.AMC_DATA_SOURCE = 'gpu1'
    process.env.AMC_SUPABASE_URL = 'https://postgres.internal.example'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
    process.env.LANGGRAPH_SERVER_SECRET = 'langgraph-secret'
    getLearningRuntimeHealth.mockResolvedValue({
      status: 'not_configured',
      checkedAt: '2026-08-02T00:00:00.000Z',
      endpoint: null,
      capabilities: null,
      detail: 'not configured',
      latencyMs: null,
    })

    const posture = await getSettingsPostureSnapshot()

    expect(posture.operatorAuth.status).toBe('not_configured')
    expect(posture.operatorAuth.message).toMatch(/fail-closed/i)
  })
})
