/**
 * Agent Mission Control — model provider router (server only).
 *
 * One entry point the runners call instead of touching OpenAI/Anthropic/Gemini
 * directly. It resolves the provider, checks env is configured (fail-closed),
 * calls the provider, normalises tokens + cost + latency, and applies the
 * fallback policy (model-fallbacks.ts) when the primary call is unavailable.
 *
 * Providers in V1:
 *   - openai    : official SDK (already used elsewhere), key OPENAI_API_KEY.
 *   - anthropic : direct server-only fetch (no heavy dep added — mirrors the
 *                 repo's fetch-based github.ts/postgrest.ts), key ANTHROPIC_API_KEY.
 *   - google    : direct server-only fetch to the Gemini REST API, key GEMINI_API_KEY.
 *   - mistral/local : not wired → ProviderUnavailableError (fallback if allowed).
 *
 * Never import from a client component (reads provider secrets).
 */
import 'server-only'

import OpenAI from 'openai'

import { resolveFallback, type RouterPurpose } from './model-fallbacks'
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
  /** Tools the model may call (OpenAI only in this lot; ignored elsewhere). */
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
  /** Provider/model actually used (differs when a fallback fired). */
  resolvedProvider: ModelProvider
  resolvedModel: string
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
function anthropicAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY)
}
function geminiAvailable(): boolean {
  return Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY)
}

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

async function callOpenAI(req: ModelRouterRequest): Promise<RawCall> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new ProviderUnavailableError('OpenAI not configured (OPENAI_API_KEY missing)')
  const client = new OpenAI({ apiKey })

  const tools: OpenAI.Chat.Completions.ChatCompletionTool[] | undefined =
    req.tools && req.tools.length > 0
      ? req.tools.map((t) => ({
          type: 'function' as const,
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }))
      : undefined
  const toolChoice = tools ? toOpenAiToolChoice(req.toolChoice) : undefined

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

async function callAnthropic(req: ModelRouterRequest): Promise<RawCall> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new ProviderUnavailableError('Anthropic not configured (ANTHROPIC_API_KEY missing)')

  // Anthropic wants system as a top-level field, not a message. Tool-use is not
  // wired for Anthropic in this lot: keep only user/assistant text turns so a
  // `role: 'tool'` message can't slip through and get mislabelled.
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const turns = req.messages
    .filter((m): m is ModelRouterMessage & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role, content: m.content }))

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxOutputTokens ?? 2048,
        ...(system ? { system } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        messages: turns,
      }),
    })
  } catch (err) {
    throw new ModelRouterError(`anthropic/${req.model}: ${err instanceof Error ? err.message : 'network error'}`)
  }

  if (!res.ok) {
    const body = (await res.text()).slice(0, 300)
    if (res.status === 403 || res.status === 404 || /model/i.test(body)) {
      throw new ModelAccessError(`anthropic/${req.model}: ${res.status} ${body}`)
    }
    throw new ModelRouterError(`anthropic/${req.model}: ${res.status} ${body}`)
  }

  const data = (await res.json()) as {
    content?: { type: string; text?: string }[]
    usage?: { input_tokens?: number; output_tokens?: number }
    stop_reason?: string
  }
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  return {
    text,
    inputTokens: data.usage?.input_tokens ?? estimateTokens(req.messages.map((m) => m.content).join(' ')),
    outputTokens: data.usage?.output_tokens ?? estimateTokens(text),
    finishReason: data.stop_reason,
  }
}

async function callGemini(req: ModelRouterRequest): Promise<RawCall> {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
  if (!apiKey) throw new ProviderUnavailableError('Gemini not configured (GEMINI_API_KEY missing)')

  // Tool-use is not wired for Gemini in this lot: keep only user/assistant text
  // turns so a `role: 'tool'` message can't slip through mislabelled as a user.
  const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const contents = req.messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))

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
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .trim()
  return {
    text,
    inputTokens: data.usageMetadata?.promptTokenCount ?? estimateTokens(req.messages.map((m) => m.content).join(' ')),
    outputTokens: data.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
    finishReason: data.candidates?.[0]?.finishReason,
  }
}

/** Dispatch to a provider adapter, or throw ProviderUnavailableError. */
function callProvider(provider: ModelProvider, req: ModelRouterRequest): Promise<RawCall> {
  switch (provider) {
    case 'openai':
      return callOpenAI(req)
    case 'anthropic':
      return callAnthropic(req)
    case 'google':
      return callGemini(req)
    case 'mistral':
    case 'local':
      throw new ProviderUnavailableError(`provider '${provider}' is not wired in V1`)
    default:
      throw new ProviderUnavailableError(`unknown provider '${provider}'`)
  }
}

function providerAvailable(provider: ModelProvider): boolean {
  switch (provider) {
    case 'openai':
      return openAiAvailable()
    case 'anthropic':
      return anthropicAvailable()
    case 'google':
      return geminiAvailable()
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
    const costUsd = computeCostUsd(resolvedProvider, resolvedModel, raw.inputTokens, raw.outputTokens)
    return {
      text: raw.text,
      parsedJson: req.responseFormat === 'json' ? tryParseJson(raw.text) : undefined,
      provider: req.modelProvider,
      model: req.model,
      resolvedProvider,
      resolvedModel,
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
  if (providerAvailable(req.modelProvider)) {
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
