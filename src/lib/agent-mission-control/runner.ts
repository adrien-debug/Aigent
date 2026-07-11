/**
 * Agent Mission Control — execution runner (server only).
 *
 * LIVE ONLY. Executes a copilot run against the real OpenAI API and
 * persists the result to the gpu1 PostgREST perimeter (agent_runs +
 * agent_run_steps). There is no mock/dry-run mode: every call here either
 * produces a real completion + a real DB row, or throws.
 *
 * Required env: AMC_DATA_SOURCE=gpu1, AMC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * OPENAI_API_KEY (the latter is read inside ./llm-client).
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { getOpenAIClient, RUNNER_MODEL } from './llm-client'
import { pgrest } from './postgrest'
import type { AgentRunStatus, AgentRunStepKind, DurationMs, IsoTimestamp, UsdAmount } from './types'

// ---------------------------------------------------------------------------
// Pricing — gpt-5.4, per-token USD cost (estimated)
// ---------------------------------------------------------------------------
// gpt-5.4 est. pricing used by RUNNER_MODEL:
//   input:  $1.25 / 1,000,000 tokens
//   output: $10   / 1,000,000 tokens
const INPUT_USD_PER_1M = 1.25
const OUTPUT_USD_PER_1M = 10

function computeCostUsd(inputTokens: number, outputTokens: number): UsdAmount {
  const cost = (inputTokens / 1e6) * INPUT_USD_PER_1M + (outputTokens / 1e6) * OUTPUT_USD_PER_1M
  // Round to 6 decimal places (sub-cent precision) to keep numeric columns tidy.
  return Math.round(cost * 1e6) / 1e6
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
 * Execute one copilot run: call OpenAI with the copilot's system prompt +
 * user input, persist an agent_runs row and a matching agent_run_steps row,
 * and return the structured result. On OpenAI failure, still persists a
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
    const client = getOpenAIClient()
    const completion = await client.chat.completions.create({
      model: model || RUNNER_MODEL,
      messages: [
        { role: 'system', content: systemPromptSummary },
        { role: 'user', content: userInput },
      ],
      max_completion_tokens: 4096,
    })

    const replyText = (completion.choices[0]?.message?.content ?? '').trim()
    outputSummary = summarize(replyText)
    inputTokens = completion.usage?.prompt_tokens ?? 0
    outputTokens = completion.usage?.completion_tokens ?? 0

    status = 'completed'
    stepDetail = summarize(replyText || '(empty response)')
  } catch (err) {
    status = 'failed'
    stepStatus = 'error'
    const message = err instanceof Error ? err.message : String(err)
    outputSummary = summarize(`OpenAI call failed: ${message}`)
    stepDetail = outputSummary
  }

  const finishedAtMs = Date.now()
  const finishedAt: IsoTimestamp = new Date(finishedAtMs).toISOString()
  const latencyMs: DurationMs = finishedAtMs - startedAtMs
  const costUsd: UsdAmount = computeCostUsd(inputTokens, outputTokens)

  const runId = randomUUID()

  // Persist agent_runs row.
  await pgrest('POST', 'agent_runs', {
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
  await pgrest('POST', 'agent_run_steps', {
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
