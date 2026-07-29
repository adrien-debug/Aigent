/**
 * Unit tests for the generated opt-in runtime telemetry wrapper (prompt 62,
 * github.ts telemetryWrapperSource + telemetryHooks wiring into
 * handlerForRuntime, plus README/manifest scaffolding via pushAgentToRepo).
 *
 * Style follows tests/unit/generated-handler.test.ts: assertions are on the
 * generated SOURCE TEXT (regex/string checks), never a real execution of the
 * generated code — same "assert on the code, not by running it" discipline.
 * GitHub network calls are mocked via global fetch, same pattern as
 * tests/unit/pr-delivery.test.ts, so README.md / manifest.json content
 * (blob bodies) can be inspected for cases 7 and 8.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { handlerForRuntime, pushAgentToRepo, telemetryWrapperSource } from '@/lib/agent-mission-control/github'
import type { AgentManifest, AgentRuntime, Copilot, Project } from '@/lib/agent-mission-control/types'

const baseManifest = {
  systemPromptSummary: 'Read-only test agent.',
  maxStepsPerRun: 12,
} as unknown as AgentManifest

function copilot(runtime: AgentRuntime): Copilot {
  return { name: 'Test Agent', slug: `test-${runtime}`, runtime, model: 'gpt-5.4' } as unknown as Copilot
}

/** A copilot with the full identity the wrapper is expected to thread into DEFAULT_CONFIG. */
function fullCopilot(): Copilot {
  return {
    id: 'cop-1',
    name: 'Full Agent',
    slug: 'full-agent',
    projectId: 'proj-full',
    latestVersionId: 'v3',
    runtime: 'langgraph',
    model: 'gpt-5.4',
    modelProvider: 'openai',
  } as unknown as Copilot
}

const RUNTIMES: AgentRuntime[] = ['langgraph', 'openai-assistants', 'gemini', 'custom']

function withTelemetry(telemetry: AgentManifest['telemetry']): AgentManifest {
  return { ...baseManifest, telemetry } as AgentManifest
}

describe('runtime telemetry generator — handler wiring', () => {
  it('1 — the generated handler contains the telemetry wrapper when manifest.telemetry is present', () => {
    const manifest = withTelemetry({ enabled: true, endpoint: 'https://example.com/t' })
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), manifest)
      expect(src).toContain("import { withRuntimeTelemetry } from './telemetry'")
      expect(src).toMatch(/export const handle = withRuntimeTelemetry\(handleCore/)
      expect(src).toContain('async function handleCore(')
    }
  })

  it('2 — telemetry disabled by default: no wrapper import when manifest.telemetry is absent', () => {
    for (const rt of RUNTIMES) {
      const src = handlerForRuntime(copilot(rt), baseManifest)
      expect(src).not.toContain('withRuntimeTelemetry')
      expect(src).not.toContain("from './telemetry'")
      expect(src).toMatch(/export async function handle\(/)
    }
  })

  it('2b — telemetry disabled by default: enabled:false still generates the wrapper file but DEFAULT_CONFIG.enabled is false', () => {
    // manifest.telemetry PRESENT but enabled:false — per github.ts docstring
    // (":170-176") telemetry.ts is still emitted (manifest field presence
    // gates the FILE), but the runtime default inside it is inert.
    const manifest = withTelemetry({ enabled: false })
    const src = telemetryWrapperSource(manifest)
    expect(src).toMatch(/enabled:\s*false/)
    const handlerSrc = handlerForRuntime(copilot('langgraph'), manifest)
    expect(handlerSrc).toContain("from './telemetry'")
  })

  it('2c — manifest.telemetry entirely absent never wires the wrapper (back-compat, byte-identical core)', () => {
    for (const rt of RUNTIMES) {
      const withUndefined = handlerForRuntime(copilot(rt), withTelemetry(undefined))
      const withoutField = handlerForRuntime(copilot(rt), baseManifest)
      expect(withUndefined).toBe(withoutField)
    }
  })
})

describe('runtime telemetry generator — telemetryWrapperSource guard conditions', () => {
  it('3 — no telemetry send is possible without endpoint/token configured at runtime (guard before fetch, not unconditional)', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }))
    // shouldSendTelemetry() bails before any network call when config/env is incomplete.
    expect(src).toContain('function shouldSendTelemetry(')
    expect(src).toMatch(/if \(!config\.enabled\) return false/)
    expect(src).toMatch(/AIGENT_TELEMETRY_ENABLED.*!== 'true'.*return false/)
    expect(src).toMatch(/if \(!endpoint \|\| !token\) return false/)
    // The gate function is actually consulted before the wrapper does its work.
    expect(src).toMatch(/if \(!shouldSendTelemetry\(config\)\) \{\s*return handler\(input\)/)
  })

  it('4 — the wrapper never rethrows when the telemetry POST fails (try/catch around fetch)', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }))
    const sendFnMatch = src.match(/async function sendRuntimeTelemetry\([\s\S]*?\n\}/)
    expect(sendFnMatch).not.toBeNull()
    const sendFn = sendFnMatch![0]
    expect(sendFn).toMatch(/try\s*\{/)
    expect(sendFn).toMatch(/await g\.fetch\(endpoint/)
    // catch block present and swallows (no rethrow / no `throw` inside catch).
    expect(sendFn).toMatch(/\}\s*catch\s*\{/)
    const catchBlock = sendFn.slice(sendFn.lastIndexOf('catch'))
    expect(catchBlock).not.toMatch(/throw/)
    // The public wrapper itself calls sendRuntimeTelemetry fire-and-forget
    // (`void sendRuntimeTelemetry(...)`), never `await`s it inline in a way
    // that would propagate a rejection into the wrapped handler's own path.
    expect(src).toMatch(/void sendRuntimeTelemetry\(/)
  })

  it('5 — input/output are redacted by default: shape only (counts/booleans), never raw text', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }))
    expect(src).toContain('function shapeOf(')
    // shapeOf returns counters/booleans, never the value itself.
    expect(src).toMatch(/isString: true, length: value\.length/)
    expect(src).toMatch(/isArray: true, length: value\.length/)
    expect(src).toMatch(/isObject: true, keyCount: Object\.keys/)
    expect(src).toContain('inputShape: shapeOf(input)')
    expect(src).toContain('outputShape: shapeOf(result)')
    // Never interpolates the raw input/output/result value directly into the event body.
    expect(src).not.toMatch(/input:\s*input\b/)
    expect(src).not.toMatch(/output:\s*result\b/)
    expect(src).not.toMatch(/rawInput/)
    expect(src).not.toMatch(/rawOutput/)
    // Default config also documents the redaction switches, defaulted true.
    expect(src).toMatch(/redactInputs:\s*true/)
    expect(src).toMatch(/redactOutputs:\s*true/)
  })

  it('6 — the error message is hashed, never sent raw', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }))
    expect(src).toContain('async function hashErrorMessage(')
    expect(src).toMatch(/digest\('SHA-256'/)
    expect(src).toContain('messageHash')
    // The caught error's raw message is only ever fed into hashErrorMessage,
    // never assigned directly onto the outgoing event's `error` field.
    expect(src).toMatch(/const messageHash = await hashErrorMessage\(message\)/)
    expect(src).not.toMatch(/error:\s*\{[^}]*message\s*[:,]/)
    expect(src).not.toMatch(/message,\s*\n\s*category/)
  })

  it('opt-in defaults match prompt 62 §2: enabled=false, sampleRate=1, redactInputs=true, redactOutputs=true when telemetry omits them', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }))
    // enabled comes from the manifest (true here); the other three fall back
    // to the documented defaults when the manifest doesn't specify them.
    expect(src).toMatch(/sampleRate:\s*1\b/)
    expect(src).toMatch(/redactInputs:\s*true/)
    expect(src).toMatch(/redactOutputs:\s*true/)
  })

  it('honors explicit redactInputs:false / redactOutputs:false / sampleRate overrides from the manifest', () => {
    const src = telemetryWrapperSource(
      withTelemetry({ enabled: true, sampleRate: 0.25, redactInputs: false, redactOutputs: false })
    )
    expect(src).toMatch(/sampleRate:\s*0\.25/)
    expect(src).toMatch(/redactInputs:\s*false/)
    expect(src).toMatch(/redactOutputs:\s*false/)
  })
})

describe('runtime telemetry generator — required-field wiring (fix: consumer runtime signal loop)', () => {
  it('DEFAULT_CONFIG.projectId/agentId fall back to the copilot project/slug when the manifest does not override them', () => {
    // The ingestion endpoint's Zod schema requires projectId/agentId non-empty
    // (route.ts boundedString(), no .optional() gap on either). The authoring
    // flow never sets manifest.telemetry.projectId/agentId, so without this
    // fallback every emitted event failed validation (400) at the endpoint.
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), fullCopilot())
    expect(src).toMatch(/projectId:\s*`proj-full`/)
    expect(src).toMatch(/agentId:\s*`full-agent`/)
  })

  it('an explicit manifest.telemetry.projectId/agentId still wins over the copilot fallback', () => {
    const src = telemetryWrapperSource(
      withTelemetry({ enabled: true, projectId: 'override-proj', agentId: 'override-agent' }),
      fullCopilot()
    )
    expect(src).toMatch(/projectId:\s*`override-proj`/)
    expect(src).toMatch(/agentId:\s*`override-agent`/)
  })

  it('DEFAULT_CONFIG carries model/provider/agentVersion from the copilot (provider normalized to wire vocabulary)', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), fullCopilot())
    expect(src).toMatch(/model:\s*`gpt-5\.4`/)
    // internal ModelProvider 'openai' -> wire 'openai'; 'google' -> wire 'gemini' (route.ts providerEnum).
    expect(src).toMatch(/provider:\s*"openai"/)
    expect(src).toMatch(/agentVersion:\s*`v3`/)
  })

  it('google provider is normalized to the wire vocabulary "gemini", never passed through as "google"', () => {
    const c = { ...fullCopilot(), modelProvider: 'google' } as unknown as Copilot
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), c)
    expect(src).toMatch(/provider:\s*"gemini"/)
    expect(src).not.toMatch(/provider:\s*"google"/)
  })

  it('an unmapped provider (local) is omitted rather than guessed', () => {
    const c = { ...fullCopilot(), modelProvider: 'local' } as unknown as Copilot
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), c)
    expect(src).toMatch(/provider:\s*undefined/)
  })

  it('every emitted event shares ONE non-undefined runId per invocation (resolveRunId, never the old hardcoded undefined)', () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), fullCopilot())
    expect(src).toContain('function resolveRunId(')
    expect(src).toMatch(/const runId = resolveRunId\(metadata\)/)
    // All three lifecycle pings (started/completed/failed) reference the same local `runId`.
    const runIdRefs = src.match(/runId,/g) ?? []
    expect(runIdRefs.length).toBeGreaterThanOrEqual(3)
    // The old bug: the exported wrapper hardcoded `runId: undefined` at the call site with
    // no in-wrapper fallback. That literal may still appear as the metadata default (a
    // caller may not know its own run id yet), but resolveRunId must generate one.
    expect(src).toMatch(/return metadata\?\.runId \?\? randomEventId\(\)/)
  })

  it("environment.nodeEnv/runtime are normalized to the endpoint's closed enum, never an arbitrary NODE_ENV passthrough", () => {
    const src = telemetryWrapperSource(withTelemetry({ enabled: true }), fullCopilot())
    expect(src).toMatch(/rawNodeEnv === 'production' \|\| rawNodeEnv === 'development' \|\| rawNodeEnv === 'test'/)
    expect(src).toContain("'unknown'")
    expect(src).toMatch(/=\s*\{ nodeEnv, runtime: runtimeKind \}/)
  })
})

describe('runtime telemetry generator — README + manifest scaffolding', () => {
  type ApiCall = { method: string; path: string; body: unknown }
  let apiCalls: ApiCall[]
  let blobsByPath: Map<string, string>

  function jsonRes(payload: unknown, status = 200): Response {
    return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) } as Response
  }

  function installGithub() {
    apiCalls = []
    blobsByPath = new Map()
    let pendingBlobPath: string | null = null
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const u = String(url).replace('https://api.github.com/', '')
        const method = init?.method ?? 'GET'
        const body = init?.body ? JSON.parse(String(init.body)) : undefined
        apiCalls.push({ method, path: u, body })

        if (method === 'GET' && u === 'repos/owner/repo') return jsonRes({ default_branch: 'main' })
        if (method === 'GET' && u.includes('/contents/agents/_registry.json')) {
          return jsonRes({ type: 'file', content: Buffer.from('[]').toString('base64'), encoding: 'base64' })
        }
        if (method === 'GET' && u.includes('/git/refs/heads/')) return jsonRes({ object: { sha: 'headsha' } })
        if (method === 'GET' && u.includes('/git/commits/')) return jsonRes({ tree: { sha: 'basetree' } })
        if (method === 'POST' && u.endsWith('/git/blobs')) {
          // Capture file content per path by using tree call ordering: blobs.map preserves
          // order of `scaffolded` files, so stash content now and attach path on tree call.
          pendingBlobPath = null
          if (body && typeof body.content === 'string') {
            const sha = `blobsha-${blobsByPath.size}`
            blobsByPath.set(sha, body.content)
            return jsonRes({ sha })
          }
          return jsonRes({ sha: 'blobsha' })
        }
        if (method === 'POST' && u.endsWith('/git/trees')) {
          void pendingBlobPath
          return jsonRes({ sha: 'treesha' })
        }
        if (method === 'POST' && u.endsWith('/git/commits')) {
          return jsonRes({ sha: 'newcommit', html_url: 'https://github.com/owner/repo/commit/newcommit' })
        }
        if (method === 'PATCH' && u.includes('/git/refs/heads/')) return jsonRes({})
        return jsonRes({}, 404)
      })
    )
  }

  const project = { repoFullName: 'owner/repo' } as unknown as Project
  const saved = { tok: process.env.GITHUB_TOKEN, armed: process.env.GITHUB_PUSH_ENABLED }

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_PUSH_ENABLED = '1'
    installGithub()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.GITHUB_TOKEN = saved.tok
    process.env.GITHUB_PUSH_ENABLED = saved.armed
  })

  it('7 — the generated README documents the three opt-in env vars', async () => {
    const manifest = {
      version: 'v0.1.0',
      systemPromptSummary: 'Read-only test agent.',
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 1,
      confirmationPolicy: 'risky-only',
      allowedRoutes: [],
      forbiddenActions: [],
      alwaysConfirmActions: [],
      outputContract: { format: 'markdown', schemaName: null, invariants: [] },
      toolIds: [],
      telemetry: { enabled: true, endpoint: 'https://example.com/t' },
    } as unknown as AgentManifest
    const c = { slug: 'readme-agent', name: 'Readme Agent', runtime: 'langgraph', model: 'gpt-5.4', modelProvider: 'openai', id: 'c1' } as unknown as Copilot

    await pushAgentToRepo({ project, copilot: c, manifest, dryRun: false })

    const blobCalls = apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'))
    const readmeBlob = blobCalls.find(
      (call) => typeof (call.body as { content?: string }).content === 'string' && (call.body as { content: string }).content.startsWith('# Readme Agent')
    )
    expect(readmeBlob).toBeDefined()
    const readmeContent = (readmeBlob!.body as { content: string }).content
    expect(readmeContent).toContain('AIGENT_TELEMETRY_ENABLED')
    expect(readmeContent).toContain('AIGENT_TELEMETRY_ENDPOINT')
    expect(readmeContent).toContain('AIGENT_TELEMETRY_TOKEN')
    expect(readmeContent).toMatch(/opt-in/i)
    expect(readmeContent).toContain('telemetry.ts')
  })

  it('README omits the telemetry section entirely when manifest.telemetry is absent', async () => {
    const manifest = {
      version: 'v0.1.0',
      systemPromptSummary: 'Read-only test agent.',
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 1,
      confirmationPolicy: 'risky-only',
      allowedRoutes: [],
      forbiddenActions: [],
      alwaysConfirmActions: [],
      outputContract: { format: 'markdown', schemaName: null, invariants: [] },
      toolIds: [],
    } as unknown as AgentManifest
    const c = { slug: 'no-telemetry-agent', name: 'No Telemetry Agent', runtime: 'langgraph', model: 'gpt-5.4', modelProvider: 'openai', id: 'c2' } as unknown as Copilot

    await pushAgentToRepo({ project, copilot: c, manifest, dryRun: false })

    const blobCalls = apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'))
    const readmeBlob = blobCalls.find(
      (call) => typeof (call.body as { content?: string }).content === 'string' && (call.body as { content: string }).content.startsWith('# No Telemetry Agent')
    )
    expect(readmeBlob).toBeDefined()
    const readmeContent = (readmeBlob!.body as { content: string }).content
    expect(readmeContent).not.toContain('AIGENT_TELEMETRY_ENABLED')
    expect(readmeContent).not.toContain('telemetry.ts')

    // No telemetry.ts blob is written at all in this run's blobs.
    const telemetryBlob = blobCalls.find(
      (call) => typeof (call.body as { content?: string }).content === 'string' && (call.body as { content: string }).content.includes('withRuntimeTelemetry')
    )
    expect(telemetryBlob).toBeUndefined()
  })

  it('8 — the serialized manifest.json includes the optional telemetry field when provided', async () => {
    const manifest = {
      version: 'v0.1.0',
      systemPromptSummary: 'Read-only test agent.',
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 1,
      confirmationPolicy: 'risky-only',
      allowedRoutes: [],
      forbiddenActions: [],
      alwaysConfirmActions: [],
      outputContract: { format: 'markdown', schemaName: null, invariants: [] },
      toolIds: [],
      telemetry: { enabled: true, endpoint: 'https://example.com/t', sampleRate: 0.5, redactInputs: true, redactOutputs: true },
    } as unknown as AgentManifest
    const c = { slug: 'manifest-agent', name: 'Manifest Agent', runtime: 'langgraph', model: 'gpt-5.4', modelProvider: 'openai', id: 'c3' } as unknown as Copilot

    await pushAgentToRepo({ project, copilot: c, manifest, dryRun: false })

    const blobCalls = apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'))
    const manifestBlob = blobCalls.find((call) => {
      const content = (call.body as { content?: string }).content
      return typeof content === 'string' && content.includes('"copilotId"') === false && content.trimStart().startsWith('{') && content.includes('"telemetry"')
    })
    expect(manifestBlob).toBeDefined()
    const parsed = JSON.parse((manifestBlob!.body as { content: string }).content) as AgentManifest
    expect(parsed.telemetry).toEqual({ enabled: true, endpoint: 'https://example.com/t', sampleRate: 0.5, redactInputs: true, redactOutputs: true })
  })

  it('manifest.json omits the telemetry key entirely when the manifest has no telemetry field', async () => {
    const manifest = {
      version: 'v0.1.0',
      systemPromptSummary: 'Read-only test agent.',
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 1,
      confirmationPolicy: 'risky-only',
      allowedRoutes: [],
      forbiddenActions: [],
      alwaysConfirmActions: [],
      outputContract: { format: 'markdown', schemaName: null, invariants: [] },
      toolIds: [],
    } as unknown as AgentManifest
    const c = { slug: 'plain-agent', name: 'Plain Agent', runtime: 'langgraph', model: 'gpt-5.4', modelProvider: 'openai', id: 'c4' } as unknown as Copilot

    await pushAgentToRepo({ project, copilot: c, manifest, dryRun: false })

    const blobCalls = apiCalls.filter((call) => call.method === 'POST' && call.path.endsWith('/git/blobs'))
    const manifestBlob = blobCalls.find((call) => {
      const content = (call.body as { content?: string }).content
      return typeof content === 'string' && content.trimStart().startsWith('{') && content.includes('"version"')
    })
    expect(manifestBlob).toBeDefined()
    expect((manifestBlob!.body as { content: string }).content).not.toContain('"telemetry"')
  })
})
