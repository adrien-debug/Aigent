/**
 * Agent Mission Control — execution runner (server only).
 *
 * LIVE ONLY. Executes a copilot run against the real Anthropic API and
 * persists the result to the gpu1 PostgREST perimeter (agent_runs +
 * agent_run_steps). There is no mock/dry-run mode: every call here either
 * produces a real Claude completion + a real DB row, or throws.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * ANTHROPIC_API_KEY (the latter is read inside ./anthropic-client).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { getAnthropicClient, RUNNER_MODEL } from './anthropic-client'
import type { AgentRunStatus, AgentRunStepKind, DurationMs, IsoTimestamp, UsdAmount } from './types'

// ---------------------------------------------------------------------------
// Pricing — Claude Sonnet, per-token USD cost
// ---------------------------------------------------------------------------
// Anthropic list pricing for the Sonnet tier used by RUNNER_MODEL:
//   input:  $3  / 1,000,000 tokens
//   output: $15 / 1,000,000 tokens
// (No prompt-caching discount applied here — this runner does not use the
// cache_control blocks, so every input token is billed at the base rate.)
const PRICE_USD_PER_INPUT_TOKEN = 3 / 1_000_000
const PRICE_USD_PER_OUTPUT_TOKEN = 15 / 1_000_000

function computeCostUsd(inputTokens: number, outputTokens: number): UsdAmount {
  const cost = inputTokens * PRICE_USD_PER_INPUT_TOKEN + outputTokens * PRICE_USD_PER_OUTPUT_TOKEN
  // Round to 6 decimal places (sub-cent precision) to keep numeric columns tidy.
  return Math.round(cost * 1e6) / 1e6
}

// ---------------------------------------------------------------------------
// Minimal inline PostgREST write helper (this file's own copy — restWrite from
// data.ts is out of scope: single-owner file boundaries forbid importing it).
// ---------------------------------------------------------------------------

function requireBackend(): { base: string; key: string } {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    throw new Error(
      'Agent Mission Control is live-only: set AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL and ' +
        'SUPABASE_SERVICE_ROLE_KEY. No mock dataset is bundled.'
    )
  }
  return { base, key }
}

/** POST a row to a PostgREST table and return the inserted representation. */
async function insertRow<T extends Record<string, unknown>>(
  table: string,
  body: Record<string, unknown>
): Promise<T> {
  const { base, key } = requireBackend()
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`PostgREST POST ${res.status} on ${table}: ${(await res.text()).slice(0, 300)}`)
  }
  const rows = (await res.json()) as T[]
  return rows[0]
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface ExecuteCopilotRunArgs {
  copilotId: string
  versionId: string
  projectId: string
  model: string
  systemPromptSummary: string
  userInput: string
  maxSteps: number
}

export interface ExecuteCopilotRunStep {
  index: number
  kind: AgentRunStepKind
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  startedAt: IsoTimestamp
  durationMs: DurationMs
}

export interface ExecuteCopilotRunResult {
  runId: string
  status: AgentRunStatus
  outputSummary: string
  latencyMs: DurationMs
  costUsd: UsdAmount
  steps: ExecuteCopilotRunStep[]
}

/** Truncate long text to a single-line summary for input_summary/output_summary columns. */
function summarize(text: string, maxLen = 400): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > maxLen ? `${flat.slice(0, maxLen - 1)}…` : flat
}

/**
 * Execute one copilot run: call Claude with the copilot's system prompt +
 * user input, persist an agent_runs row and a matching agent_run_steps row,
 * and return the structured result. On Anthropic failure, still persists a
 * `failed` run so the run history stays complete.
 */
export async function executeCopilotRun(
  args: ExecuteCopilotRunArgs
): Promise<ExecuteCopilotRunResult> {
  const { copilotId, versionId, projectId, model, systemPromptSummary, userInput, maxSteps } = args

  const startedAtMs = Date.now()
  const startedAt: IsoTimestamp = new Date(startedAtMs).toISOString()

  let status: AgentRunStatus
  let outputSummary: string
  let inputTokens = 0
  let outputTokens = 0
  let stepStatus: 'ok' | 'error' = 'ok'
  let stepDetail: string

  try {
    const client = getAnthropicClient()
    const completion = await client.messages.create({
      model: model || RUNNER_MODEL,
      max_tokens: 4096,
      system: systemPromptSummary,
      messages: [{ role: 'user', content: userInput }],
    })

    const textBlock = completion.content.find(
      (block): block is { type: 'text'; text: string } => block.type === 'text'
    )
    outputSummary = summarize(textBlock?.text ?? '')
    inputTokens = completion.usage?.input_tokens ?? 0
    outputTokens = completion.usage?.output_tokens ?? 0

    status = 'completed'
    stepDetail = summarize(textBlock?.text ?? '(empty response)')
  } catch (err) {
    status = 'failed'
    stepStatus = 'error'
    const message = err instanceof Error ? err.message : String(err)
    outputSummary = summarize(`Anthropic call failed: ${message}`)
    stepDetail = outputSummary
  }

  const finishedAtMs = Date.now()
  const finishedAt: IsoTimestamp = new Date(finishedAtMs).toISOString()
  const latencyMs: DurationMs = finishedAtMs - startedAtMs
  const costUsd: UsdAmount = computeCostUsd(inputTokens, outputTokens)

  const runId = randomUUID()

  // Persist agent_runs row.
  await insertRow('agent_runs', {
    id: runId,
    copilot_id: copilotId,
    version_id: versionId,
    project_id: projectId,
    user_label: 'authoring-session',
    started_at: startedAt,
    finished_at: finishedAt,
    status,
    input_summary: summarize(userInput),
    output_summary: outputSummary,
    tool_call_count: 0,
    unsafe_attempt_count: 0,
    latency_ms: latencyMs,
    cost_usd: costUsd,
    trace_url: null,
    created_via: 'authoring',
  })

  // Persist a single output step describing the LLM call outcome.
  const stepStartedAt = startedAt
  const stepDurationMs = latencyMs
  await insertRow('agent_run_steps', {
    id: randomUUID(),
    run_id: runId,
    index: 0,
    kind: 'output' satisfies AgentRunStepKind,
    title: status === 'completed' ? 'Model response' : 'Model call failed',
    detail: stepDetail,
    status: stepStatus,
    started_at: stepStartedAt,
    duration_ms: stepDurationMs,
    tool_call_id: null,
  })

  // maxSteps is accepted for interface parity with future multi-step runs
  // (tool calls, guardrail checks, etc.); this V1 runner always performs a
  // single LLM-call step and never exceeds the cap.
  void maxSteps

  const steps: ExecuteCopilotRunStep[] = [
    {
      index: 0,
      kind: 'output',
      title: status === 'completed' ? 'Model response' : 'Model call failed',
      detail: stepDetail,
      status: stepStatus,
      startedAt: stepStartedAt,
      durationMs: stepDurationMs,
    },
  ]

  return {
    runId,
    status,
    outputSummary,
    latencyMs,
    costUsd,
    steps,
  }
}
