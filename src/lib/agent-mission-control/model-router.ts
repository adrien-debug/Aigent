/**
 * Agent Mission Control — model provider router (server only).
 *
 * One entry point the runners call instead of touching OpenAI/Gemini
 * directly. It resolves the provider, checks env is configured (fail-closed),
 * calls the provider, normalises tokens + cost + latency, and applies the
 * fallback policy (model-fallbacks.ts) when the primary call is unavailable.
 *
 * Providers in V1:
 *   - openai    : official SDK (already used elsewhere), key OPENAI_API_KEY.
 *   - google    : Gemini REST API (text + tool-use).
 *   - local     : Adrien's vLLM park (OpenAI-compatible), key VLLM_LOCAL_API_KEY +
 *                 one URL env var per endpoint (model-local.ts). Explicit opt-in:
 *                 only reached when a request selects provider 'local' AND one of
 *                 the LOCAL_VLLM_MODEL_IDS — never a silent redirect of defaults.
 *                 Endpoint down/unconfigured → ProviderUnavailableError, so the
 *                 standard fallback policy (model-fallbacks.ts) applies.
 *
 * Never import from a client component (reads provider secrets).
 */
import 'server-only'

import OpenAI from 'openai'

import { resolveFallback, type RouterPurpose } from './model-fallbacks'
import { localVllmAvailable, resolveLocalVllmEndpoint } from './model-local'
import { computeCostUsd, estimateTokens } from './model-pricing'
import { ModelAccessError, ModelRouterError, ProviderUnavailableError } from './runner-errors'
import type { ModelProvider } from './types'

/** A tool the model may call (provider-agnostic; JSON Schema `parameters`). */
export interface ModelRouterTool {
  name: string
  description: string
  parameters: Record<string, unknown> // JSON Schema object
}

/** A tool call the model requested (id + name + raw JSON arguments). */
export interface ModelRouterToolCall {
  id: string
  name: string
  argumentsJson: string // raw JSON string of arguments the model chose
}

export interface ModelRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  /** Set on `role: 'tool'` messages — the tool call this result answers. */
  toolCallId?: string
  /** Set on an assistant message that requested tools (to replay in history). */
  toolCalls?: ModelRouterToolCall[]
}

export interface ModelRouterRequest {
  purpose: RouterPurpose
  modelProvider: ModelProvider
  model: string
  messages: ModelRouterMessage[]
  temperature?: number
  responseFormat?: 'text' | 'json'
  maxOutputTokens?: number
  /** Per-request opt-in to run/benchmark fallbacks (OR-ed with the env flag). */
  allowFallback?: boolean
  /** Tools the model may call (OpenAI + local vLLM + Gemini). */
  tools?: ModelRouterTool[]
  /** How the model may use tools. Mapped to the provider's `tool_choice`. */
  toolChoice?: 'auto' | 'none' | 'required'
}

export interface ModelRouterResponse {
  text: string
  parsedJson?: unknown
  /** Provider/model as requested. */
  provider: ModelProvider
  model: string
  /**
   * Provider/model actually used. `resolvedModel` carries the model the
   * PROVIDER reported serving when it reported one (see `modelVerified`),
   * otherwise it falls back to the requested model id.
   */
  resolvedProvider: ModelProvider
  resolvedModel: string
  /**
   * True when `resolvedModel` is the provider's own reported model id, not the
   * requested id echoed back. A run may only be persisted `model_unverified=false`
   * when this is true — it is the single source of executed-model truth.
   */
  modelVerified: boolean
  fallbackUsed: boolean
  fallbackReason?: string
  inputTokens: number
  outputTokens: number
  costUsd: number
  latencyMs: number
  rawFinishReason?: string
  /** Tool calls the model requested this turn (empty/undefined if none). */
  toolCalls?: ModelRouterToolCall[]
}

// ---------------------------------------------------------------------------
// Env availability (fail-closed helpers)
// ---------------------------------------------------------------------------

function openAiAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY)
}
function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

// Local vLLM call bounds (the endpoints are LAN/Tailscale hosts: never retry a
// dead host forever, and keep a generous ceiling for slow 70B generations).
const LOCAL_VLLM_MAX_RETRIES = 1
const LOCAL_VLLM_TIMEOUT_MS = 120_000
/** Minimum completion room required inside a local model's context window. */
const LOCAL_VLLM_MIN_COMPLETION_TOKENS = 64

/** Is an OpenAI-style access/permission error (403 / model access denied)? */
function isAccessError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const msg = err instanceof Error ? err.message : String(err)
  return status === 403 || /does not have access|model_not_found|not found|no access|403/i.test(msg)
}

interface RawCall {
  text: string
  inputTokens: number
  outputTokens: number
  finishReason?: string
  toolCalls?: ModelRouterToolCall[]
  /**
   * The model id the PROVIDER reported having served this call — OpenAI's
   * `completion.model`, Gemini's `modelVersion`, vLLM's `completion.model`.
   * This is the only independent evidence of what actually executed: the
   * requested model is an intent, this is the provider's own report. Absent
   * (undefined) only when the provider returned no model field, in which case
   * the run stays `model_unverified`.
   */
  executedModel?: string
}

// ---------------------------------------------------------------------------
// Provider adapters — each returns raw text + token usage, or throws typed.
// ---------------------------------------------------------------------------

/** Map a router message to the OpenAI chat message param (all four roles). */
function toOpenAiMessage(m: ModelRouterMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (m.role === 'tool') {
    return { role: 'tool', tool_call_id: m.toolCallId ?? '', content: m.content }
  }
  if (m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: m.content,
      tool_calls: m.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function' as const,
        function: { name: tc.name, arguments: tc.argumentsJson },
      })),
    }
  }
  // system | user | assistant (no tool calls)
  return { role: m.role, content: m.content }
}

/** Map the router's tool-choice to the OpenAI `tool_choice` option. */
function toOpenAiToolChoice(
  choice: ModelRouterRequest['toolChoice']
): OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined {
  switch (choice) {
    case 'auto':
      return 'auto'
    case 'none':
      return 'none'
    case 'required':
      return 'required'
    default:
      return undefined
  }
}

/**
 * Assemble the OpenAI-SDK `tools` + `tool_choice` params from a router request.
 * Shared by the OpenAI and local-vLLM call paths — vLLM speaks the OpenAI SDK,
 * so both build these params identically.
 */
function toOpenAiToolsParam(req: ModelRouterRequest): {
  tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined
  toolChoice: OpenAI.Chat.Completions.ChatCompletionToolChoiceOption | undefined
} {
  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
    req.tools && req.tools.length > 0
      ? req.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined
  const toolChoice = tools ? toOpenAiToolChoice(req.toolChoice) : undefined
  return { tools, toolChoice }
}

async function callOpenAI(req: ModelRouterRequest): Promise<RawCall> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new ProviderUnavailableError('OpenAI not configured (OPENAI_API_KEY missing)')
  const client = new OpenAI({ apiKey })

  const { tools, toolChoice } = toOpenAiToolsParam(req)

  try {
    const completion = await client.chat.completions.create({
      model: req.model,
      messages: req.messages.map(toOpenAiMessage),
      max_completion_tokens: req.maxOutputTokens ?? 2048,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(tools ? { tools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    })
    const message = completion.choices[0]?.message
    const toolCalls: ModelRouterToolCall[] = (message?.tool_calls ?? [])
      .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
      .map((tc) => ({ id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments }))
    return {
      // Keep any assistant content, but never trim it away to '' when tools are
      // called — the runner may want the (possibly empty) content verbatim.
      text: (message?.content ?? '').trim(),
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      finishReason: completion.choices[0]?.finish_reason ?? undefined,
      // OpenAI echoes the exact served model (often a dated snapshot id) —
      // capture it as the ground-truth executed model.
      ...(completion.model ? { executedModel: completion.model } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  } catch (err) {
    if (isAccessError(err)) {
      throw new ModelAccessError(
        `openai/${req.model}: ${err instanceof Error ? err.message : 'model access denied'}`
      )
    }
    throw new ModelRouterError(
      `openai/${req.model}: ${err instanceof Error ? err.message : 'upstream error'}`
    )
  }
}

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

function parseJsonRecord(text: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {
    // fall through
  }
  return { result: text }
}

function buildGeminiContents(messages: ModelRouterMessage[]) {
  const nameByCallId = new Map<string, string>()
  const contents: { role: 'user' | 'model'; parts: GeminiPart[] }[] = []

  for (const message of messages) {
    if (message.role === 'system') continue

    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] })
      continue
    }

    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content.trim().length > 0) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        nameByCallId.set(call.id, call.name)
        parts.push({ functionCall: { name: call.name, args: parseJsonRecord(call.argumentsJson) } })
      }
      if (parts.length > 0) contents.push({ role: 'model', parts })
      continue
    }

    if (message.role === 'tool') {
      const name =
        (message.toolCallId ? nameByCallId.get(message.toolCallId) : undefined) ?? message.toolCallId ?? 'tool'
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name, response: parseJsonRecord(message.content) } }],
      })
    }
  }

  return contents
}

function toGeminiTools(tools: ModelRouterTool[]) {
  return [
    {
      functionDeclarations: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
    },
  ]
}

function toGeminiToolMode(choice: ModelRouterRequest['toolChoice']): 'AUTO' | 'ANY' | 'NONE' | undefined {
  switch (choice) {
    case 'auto':
      return 'AUTO'
    case 'required':
      return 'ANY'
    case 'none':
      return 'NONE'
    default:
      return undefined
  }
}

async function callGemini(req: ModelRouterRequest): Promise<RawCall> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) throw new ProviderUnavailableError('Gemini not configured (GEMINI_API_KEY missing)')

  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = buildGeminiContents(req.messages)
  const tools = req.tools && req.tools.length > 0 ? toGeminiTools(req.tools) : undefined
  const toolMode = tools ? toGeminiToolMode(req.toolChoice) : undefined

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    req.model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents,
        ...(tools ? { tools } : {}),
        ...(toolMode ? { toolConfig: { functionCallingConfig: { mode: toolMode } } } : {}),
        generationConfig: {
          maxOutputTokens: req.maxOutputTokens ?? 2048,
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        },
      }),
    })
  } catch (err) {
    throw new ModelRouterError(`google/${req.model}: ${err instanceof Error ? err.message : 'network error'}`)
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    if (res.status === 403 || res.status === 404 || /model/i.test(body)) {
      throw new ModelAccessError(`google/${req.model}: ${res.status} ${body}`)
    }
    throw new ModelRouterError(`google/${req.model}: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    candidates?: {
      content?: { parts?: { text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }[] }
      finishReason?: string
    }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
    /** Gemini reports the served model version here — our executed-model proof. */
    modelVersion?: string
  }

  const parts = data.candidates?.[0]?.content?.parts ?? []
  const text = parts
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  const toolCalls: ModelRouterToolCall[] = parts
    .filter((p) => p.functionCall?.name)
    .map((p, index) => ({
      id: `gemini_call_${index}`,
      name: p.functionCall!.name!,
      argumentsJson: JSON.stringify(p.functionCall!.args ?? {}),
    }))

  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? estimateTokens(req.messages.map((m) => m.content).join(' ')),
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
    finishReason: data.candidates?.[0]?.finishReason,
    ...(data.modelVersion ? { executedModel: data.modelVersion } : {}),
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
  }
}

async function callLocalVllm(req: ModelRouterRequest): Promise<RawCall> {
  const endpoint = resolveLocalVllmEndpoint(req.model)
  if (!endpoint) {
    throw new ProviderUnavailableError(
      `local/${req.model}: endpoint not configured (VLLM_LOCAL_API_KEY or its URL env var missing, or unknown local model id)`
    )
  }
  const client = new OpenAI({
    apiKey: endpoint.apiKey,
    baseURL: endpoint.baseUrl,
    maxRetries: LOCAL_VLLM_MAX_RETRIES,
    timeout: LOCAL_VLLM_TIMEOUT_MS,
  })

  // Bound the completion to the endpoint's context window (prompt + completion).
  const estimatedInput = estimateTokens(req.messages.map((m) => m.content).join(' '))
  const contextRoom = endpoint.contextTokens - estimatedInput
  if (contextRoom < LOCAL_VLLM_MIN_COMPLETION_TOKENS) {
    throw new ModelRouterError(
      `local/${req.model}: prompt (~${estimatedInput} tokens) leaves no room in the ${endpoint.contextTokens}-token context window`
    )
  }
  const maxCompletionTokens = Math.min(req.maxOutputTokens ?? 2048, contextRoom)

  const { tools, toolChoice } = toOpenAiToolsParam(req)

  try {
    const completion = await client.chat.completions.create({
      model: endpoint.upstreamModel,
      messages: req.messages.map(toOpenAiMessage),
      max_completion_tokens: maxCompletionTokens,
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(tools ? { tools } : {}),
      ...(toolChoice !== undefined ? { tool_choice: toolChoice } : {}),
    })
    const message = completion.choices[0]?.message
    const toolCalls: ModelRouterToolCall[] = (message?.tool_calls ?? [])
      .filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageFunctionToolCall => tc.type === 'function')
      .map((tc) => ({ id: tc.id, name: tc.function.name, argumentsJson: tc.function.arguments }))
    return {
      text: (message?.content ?? '').trim(),
      inputTokens: completion.usage?.prompt_tokens ?? estimatedInput,
      outputTokens: completion.usage?.completion_tokens ?? estimateTokens(message?.content ?? ''),
      finishReason: completion.choices[0]?.finish_reason ?? undefined,
      // vLLM serves under a `served-model-name`; capture what it reports so a
      // redeployed park under a different id is detectable, not assumed.
      ...(completion.model ? { executedModel: completion.model } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    }
  } catch (err) {
    // Host down / connection refused / timeout → routable so the standard
    // fallback policy can take over (the park may be partially deployed).
    if (err instanceof OpenAI.APIConnectionError) {
      throw new ProviderUnavailableError(
        `local/${req.model}: endpoint unreachable at ${endpoint.baseUrl} (${err.message})`
      )
    }
    if (isAccessError(err)) {
      throw new ModelAccessError(
        `local/${req.model}: ${err instanceof Error ? err.message : 'model access denied'}`
      )
    }
    throw new ModelRouterError(
      `local/${req.model}: ${err instanceof Error ? err.message : 'upstream error'}`
    )
  }
}

/** Dispatch to a provider adapter, or throw ProviderUnavailableError. */
function callProvider(provider: ModelProvider, req: ModelRouterRequest): Promise<RawCall> {
  switch (provider) {
    case 'openai':
      return callOpenAI(req)
    case 'google':
      return callGemini(req)
    case 'local':
      return callLocalVllm(req)
    default:
      throw new ProviderUnavailableError(`unknown provider '${provider}'`)
  }
}

/**
 * Single source of truth for "is this provider/model actually configured?".
 * Exported so pre-flight callers (the benchmark sweep) judge availability the
 * exact same way the router will at call time — a second copy would let the
 * sweep skip a model the router would have run.
 */
export function providerAvailable(provider: ModelProvider, model: string): boolean {
  switch (provider) {
    case 'openai':
      return openAiAvailable()
    case 'google':
      return geminiAvailable()
    case 'local':
      return localVllmAvailable(model)
    default:
      return false
  }
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

function tryParseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    return undefined
  }
}

/**
 * Route one completion through the requested provider, applying the fallback
 * policy on ProviderUnavailable / ModelAccess / ModelUnavailable failures.
 * Returns a fully normalised response (tokens, cost, latency, fallback flags).
 * Throws a typed ModelRouterError family error if the call cannot be served.
 */
export async function routeCompletion(req: ModelRouterRequest): Promise<ModelRouterResponse> {
  const startedMs = Date.now()

  const finalize = (
    raw: RawCall,
    resolvedProvider: ModelProvider,
    resolvedModel: string,
    fallbackUsed: boolean,
    fallbackReason?: string
  ): ModelRouterResponse => {
    // The executed model is the provider's own reported id when present; only
    // then is the run verifiable. Absent → keep the requested id but mark it
    // unverified, never dressing an assumption as a fact.
    const verifiedModel = raw.executedModel ?? resolvedModel
    const modelVerified = raw.executedModel != null
    const costUsd = computeCostUsd(resolvedProvider, verifiedModel, raw.inputTokens, raw.outputTokens)
    return {
      text: raw.text,
      parsedJson: req.responseFormat === 'json' ? tryParseJson(raw.text) : undefined,
      provider: req.modelProvider,
      model: req.model,
      resolvedProvider,
      resolvedModel: verifiedModel,
      modelVerified,
      fallbackUsed,
      fallbackReason,
      inputTokens: raw.inputTokens,
      outputTokens: raw.outputTokens,
      costUsd,
      latencyMs: Date.now() - startedMs,
      rawFinishReason: raw.finishReason,
      toolCalls: raw.toolCalls,
    }
  }

  // Primary attempt (only if the provider's env is present — otherwise skip
  // straight to fallback resolution with a clear reason).
  let primaryError: Error | null = null
  if (providerAvailable(req.modelProvider, req.model)) {
    try {
      const raw = await callProvider(req.modelProvider, req)
      return finalize(raw, req.modelProvider, req.model, false)
    } catch (err) {
      primaryError = err instanceof Error ? err : new Error(String(err))
      // A generic upstream error (not access/unavailable) is a real failure of
      // an available provider — don't paper over it with a fallback.
      const routable =
        err instanceof ProviderUnavailableError || err instanceof ModelAccessError
      if (!routable) throw primaryError
    }
  } else {
    primaryError = new ProviderUnavailableError(
      `provider '${req.modelProvider}' not configured (env missing)`
    )
  }

  // Fallback resolution.
  const decision = resolveFallback({
    purpose: req.purpose,
    originalReason: primaryError?.message ?? 'primary unavailable',
    requestOptIn: req.allowFallback,
    openAiAvailable: openAiAvailable(),
  })

  if (!decision) {
    // Fail closed: no fallback permitted → surface the typed primary error.
    throw primaryError ?? new ProviderUnavailableError('model unavailable and no fallback allowed')
  }

  // Execute the fallback (always OpenAI in V1).
  const fbReq: ModelRouterRequest = { ...req, modelProvider: decision.provider, model: decision.model }
  const raw = await callProvider(decision.provider, fbReq)
  return finalize(raw, decision.provider, decision.model, true, decision.reason)
}
