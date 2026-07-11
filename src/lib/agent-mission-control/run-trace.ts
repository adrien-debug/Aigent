/**
 * Agent Mission Control — run trace abstraction (server only).
 *
 * A small, honest tracing layer the runners build up as they execute, then hand
 * to the persistence layer. It captures the real shape of a run —
 * resolve-model → (fallback) → llm-call → (judge) → guardrail/safety → output —
 * as structured steps, plus provider/model/fallback/cost metadata, and a
 * traceUrl that is real ONLY if LangSmith is configured (else null; see
 * ./langsmith). It NEVER fabricates a trace URL and NEVER invents a tool call.
 *
 * Two kind spaces:
 *   - TraceStepKind (rich): includes 'judge' and 'fallback' for internal clarity.
 *   - AgentRunStepKind (DB): the 7 values the `agent_run_steps.kind` column
 *     accepts. `toDbStepKind()` maps rich → DB (judge → llm-call,
 *     fallback → guardrail-check) so we never write a kind the DB rejects.
 *
 * Never import from a client component.
 */
import 'server-only'

import { exportTrace, newTraceId, type LangSmithExportResult } from './langsmith'
import type { AgentRunStepKind, IsoTimestamp, ModelProvider } from './types'

export type TraceMode = 'run' | 'test' | 'benchmark' | 'replay' | 'shadow'

export interface TraceContext {
  runId?: string
  copilotId: string
  versionId: string
  projectId?: string | null
  mode: TraceMode
  provider?: ModelProvider
  model?: string
  resolvedProvider?: ModelProvider
  resolvedModel?: string
  fallbackUsed?: boolean
}

/** Rich step kinds — a superset of the DB kinds, with judge/fallback for clarity. */
export type TraceStepKind =
  | AgentRunStepKind // llm-call | tool-call | memory-read | memory-write | guardrail-check | confirmation | output
  | 'judge'
  | 'fallback'

export interface TraceStepInput {
  kind: TraceStepKind
  title: string
  detail: string
  status: 'ok' | 'warning' | 'blocked' | 'error'
  startedAt?: IsoTimestamp
  durationMs?: number
  toolCallId?: string | null
}

export interface TraceStep extends TraceStepInput {
  index: number
  startedAt: IsoTimestamp
  durationMs: number
  toolCallId: string | null
}

export interface TraceResult {
  traceUrl: string | null
  traceId: string | null
  steps: TraceStep[]
  summary: string
  /** True only if the trace was actually POSTed to LangSmith (never faked). */
  exported: boolean
}

/**
 * Map a rich trace kind to a DB-valid `agent_run_steps.kind`. The DB column
 * only accepts the 7 AgentRunStepKind values, so the two synthetic kinds fold
 * onto the closest real one (the title still says "Judge"/"Fallback").
 */
export function toDbStepKind(kind: TraceStepKind): AgentRunStepKind {
  switch (kind) {
    case 'judge':
      return 'llm-call'
    case 'fallback':
      return 'guardrail-check'
    default:
      return kind
  }
}

/**
 * A run trace being assembled. `step()` appends structured steps; `finish()`
 * mints a trace id + (maybe) URL and returns the immutable result. The steps it
 * collects are ready to persist to `agent_run_steps` (via toDbStepKind) and its
 * metadata feeds run/test/benchmark summaries.
 */
export class RunTrace {
  readonly context: TraceContext
  private readonly steps: TraceStep[] = []
  private readonly startedMs: number

  constructor(context: TraceContext, startedMs: number) {
    this.context = context
    this.startedMs = startedMs
  }

  /** Append a step. Missing startedAt/durationMs are stamped from `nowMs`. */
  step(input: TraceStepInput, nowMs: number): void {
    this.steps.push({
      ...input,
      index: this.steps.length,
      startedAt: input.startedAt ?? new Date(nowMs).toISOString(),
      durationMs: Math.max(0, Math.round(input.durationMs ?? 0)),
      toolCallId: input.toolCallId ?? null,
    })
  }

  /** Update the resolved provider/model/fallback on the context (post-routing). */
  resolve(resolvedProvider: ModelProvider, resolvedModel: string, fallbackUsed: boolean): void {
    this.context.resolvedProvider = resolvedProvider
    this.context.resolvedModel = resolvedModel
    this.context.fallbackUsed = fallbackUsed
  }

  /** Number of steps collected so far. */
  get length(): number {
    return this.steps.length
  }

  /**
   * Freeze the trace: mint a trace id, resolve the (maybe null) LangSmith URL,
   * and build a one-line provider/model/fallback summary. `summary` is safe to
   * embed in output_summary / actual_behavior (no secrets).
   */
  private buildSummary(): string {
    const parts: string[] = []
    const prov = this.context.resolvedProvider ?? this.context.provider
    const model = this.context.resolvedModel ?? this.context.model
    if (prov && model) parts.push(`${prov}/${model}`)
    if (this.context.fallbackUsed) parts.push('fallback')
    parts.push(`${this.steps.length} steps`)
    return parts.join(' · ')
  }

  /**
   * Freeze AND export to LangSmith (async). Fail-open: if the export no-ops
   * (no key) or errors, the run is unaffected — `exported` reflects reality and
   * `traceUrl` stays honest (null unless a deep-link base resolves). The
   * exported id is the same id the deep-link is built from.
   */
  async finishAndExport(
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>,
    startedAt: IsoTimestamp,
    finishedAt: IsoTimestamp
  ): Promise<TraceResult> {
    const traceId = newTraceId()
    const result: LangSmithExportResult = await exportTrace({
      traceId,
      name: `amc-${this.context.mode}`,
      runType: 'chain',
      inputs,
      outputs,
      metadata: {
        mode: this.context.mode,
        copilotId: this.context.copilotId,
        versionId: this.context.versionId,
        provider: this.context.resolvedProvider ?? this.context.provider,
        model: this.context.resolvedModel ?? this.context.model,
        fallbackUsed: this.context.fallbackUsed ?? false,
      },
      steps: this.steps.map((s) => ({
        name: s.title,
        kind: s.kind,
        status: s.status,
        detail: s.detail,
        startedAt: s.startedAt,
        durationMs: s.durationMs,
      })),
      startedAt,
      finishedAt,
    })
    return {
      traceId,
      traceUrl: result.traceUrl,
      steps: [...this.steps],
      summary: this.buildSummary(),
      exported: result.exported,
    }
  }
}

/** Start a trace, stamping the run's start time. */
export function startTrace(context: TraceContext, startedMs: number): RunTrace {
  return new RunTrace(context, startedMs)
}
