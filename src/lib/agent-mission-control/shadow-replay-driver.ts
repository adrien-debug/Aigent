import 'server-only'

import { randomUUID } from 'node:crypto'

import type { ShadowReplayDriver } from './qualification-orchestrator'
import { runReplayComparison, verdictToStatus } from './replay'
import { makeLiveReplayRunner } from './replay-live'
import { pgrest, PgrestError } from './postgrest'
import { emitReplayTelemetry, emitShadowTelemetry } from './runtime-telemetry-store'
import { runShadowExperiment } from './shadow'
import { loadCandidateExec, makeLiveShadowAgent } from './shadow-live'
import { readVersionStage } from './shadow-replay-routes-shared'

type RawRow = Record<string, unknown>

function totalMeasuredCost(values: readonly (number | null)[]): number | null {
  if (values.some((value) => value === null || !Number.isFinite(value))) return null
  return values.reduce<number>((sum, value) => sum + (value as number), 0)
}

async function existingByKey(table: string, copilotId: string, key: string): Promise<RawRow | null> {
  const rows = await pgrest<RawRow[]>(
    'GET',
    `${table}?copilot_id=eq.${encodeURIComponent(copilotId)}&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`,
  )
  return rows[0] ?? null
}

async function reserve(
  table: string,
  row: RawRow,
  copilotId: string,
  key: string,
): Promise<RawRow> {
  const existing = await existingByKey(table, copilotId, key)
  if (existing) return existing
  try {
    const inserted = await pgrest<RawRow[]>('POST', table, row)
    return inserted[0] ?? row
  } catch (error) {
    if (error instanceof PgrestError && error.status === 409) {
      const winner = await existingByKey(table, copilotId, key)
      if (winner) return winner
    }
    throw error
  }
}

async function runShadow(
  args: Parameters<ShadowReplayDriver['runShadow']>[0],
): ReturnType<ShadowReplayDriver['runShadow']> {
  const idempotencyKey = `${args.qualificationRunId}:shadow`
  const experimentId = `shadow-${randomUUID()}`
  const exec = await loadCandidateExec(args.candidateVersionId)
  const reserved = await reserve(
    'shadow_experiments',
    {
      id: experimentId,
      copilot_id: args.copilotId,
      name: `qualification shadow ${args.candidateVersionId}`,
      production_version_id: args.productionVersionId ?? args.candidateVersionId,
      candidate_version_id: args.candidateVersionId,
      started_at: new Date().toISOString(),
      ends_at: null,
      status: 'queued',
      sampled_run_count: null,
      agreement_rate: null,
      agreement_threshold: 0.95,
      unsafe_proposal_count: null,
      would_mutate_count: 0,
      mismatches: [],
      triggered_by: 'qualification-orchestrator',
      execution_mode: 'live_langgraph',
      idempotency_key: idempotencyKey,
      qualification_run_id: args.qualificationRunId,
      source_run_id: args.sourceRunId,
      content_hash: args.contentHash,
      provider: exec.modelProvider,
      model: exec.model,
      cost_usd: null,
      version_verified: false,
    },
    args.copilotId,
    idempotencyKey,
  )
  const id = reserved.id as string
  if (reserved.status === 'completed') {
    return { evidenceId: id, verdict: reserved.candidate_verdict as string }
  }
  if (reserved.status === 'running') {
    throw new Error(`shadow experiment ${id} is already running`)
  }
  await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(id)}`, {
    status: 'running',
    started_at: new Date().toISOString(),
    ends_at: null,
  })
  try {
    await emitShadowTelemetry({
      eventType: 'shadow_started',
      copilotId: args.copilotId,
      candidateVersionId: args.candidateVersionId,
      experimentId: id,
      provider: exec.modelProvider,
      model: exec.model,
      contentHash: args.contentHash,
      qualificationRunId: args.qualificationRunId,
    })
  } catch (error) {
    await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(id)}`, {
      status: 'stopped',
      ends_at: new Date().toISOString(),
    }).catch(() => {})
    throw error
  }

  let cleanup: (() => Promise<void>) | null = null
  try {
    const live = await makeLiveShadowAgent(args.candidateVersionId)
    cleanup = live.cleanup
    const record = await runShadowExperiment({
      copilotId: args.copilotId,
      productionVersionId: args.productionVersionId ?? args.candidateVersionId,
      candidateVersionId: args.candidateVersionId,
      inputs: args.inputs,
      runAgent: live.runAgent,
    })
    if ((await readVersionStage(args.candidateVersionId)) === 'archived') {
      throw new Error('candidate was archived during shadow execution')
    }
    const costUsd = totalMeasuredCost(record.results.map((result) => result.costUsd))
    await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(id)}`, {
      status: 'completed',
      ends_at: record.endsAt,
      sampled_run_count: record.sampledRunCount,
      would_mutate_count: record.wouldMutateCount,
      candidate_verdict: record.verdict,
      cost_usd: costUsd,
      mismatches: record.results.map((result) => ({
        input: result.input,
        ok: result.ok,
        wouldMutate: result.wouldMutateCount,
        error: result.error,
        latencyMs: result.latencyMs,
        costUsd: result.costUsd,
      })),
    })
    await emitShadowTelemetry({
      eventType: 'shadow_completed',
      copilotId: args.copilotId,
      candidateVersionId: args.candidateVersionId,
      experimentId: id,
      verdict: record.verdict,
      wouldMutateCount: record.wouldMutateCount,
      provider: exec.modelProvider,
      model: exec.model,
      contentHash: args.contentHash,
      qualificationRunId: args.qualificationRunId,
    })
    return { evidenceId: id, verdict: record.verdict }
  } catch (error) {
    console.error('[shadow-replay-driver] shadow execution failed', {
      experimentId: id,
      qualificationRunId: args.qualificationRunId,
      error: error instanceof Error ? error.message : 'unknown error',
    })
    await pgrest('PATCH', `shadow_experiments?id=eq.${encodeURIComponent(id)}`, {
      status: 'stopped',
      ends_at: new Date().toISOString(),
    }).catch(() => {})
    throw error
  } finally {
    if (cleanup) await cleanup().catch(() => {})
  }
}

async function runReplay(
  args: Parameters<ShadowReplayDriver['runReplay']>[0],
): ReturnType<ShadowReplayDriver['runReplay']> {
  if (!args.referenceVersionId) throw new Error('replay requires a production reference version')
  const idempotencyKey = `${args.qualificationRunId}:replay`
  const comparisonId = `replay-${randomUUID()}`
  const candidateExec = await loadCandidateExec(args.candidateVersionId)
  const reserved = await reserve(
    'replay_comparisons',
    {
      id: comparisonId,
      copilot_id: args.copilotId,
      source_run_id: args.sourceRunId ?? args.referenceVersionId,
      candidate_version_id: args.candidateVersionId,
      created_at: new Date().toISOString(),
      status: 'queued',
      case_count: null,
      candidates: [],
      triggered_by: 'qualification-orchestrator',
      execution_mode: 'live_langgraph',
      idempotency_key: idempotencyKey,
      qualification_run_id: args.qualificationRunId,
      content_hash: args.contentHash,
      provider: candidateExec.modelProvider,
      model: candidateExec.model,
      cost_usd: null,
      version_verified: false,
    },
    args.copilotId,
    idempotencyKey,
  )
  const id = reserved.id as string
  if (['ready', 'matched', 'diverged'].includes(reserved.status as string)) {
    return { evidenceId: id, verdict: reserved.verdict as string }
  }
  if (reserved.status === 'running') {
    throw new Error(`replay comparison ${id} is already running`)
  }
  await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(id)}`, { status: 'running' })
  try {
    await emitReplayTelemetry({
      eventType: 'replay_started',
      copilotId: args.copilotId,
      candidateVersionId: args.candidateVersionId,
      comparisonId: id,
      provider: candidateExec.modelProvider,
      model: candidateExec.model,
      contentHash: args.contentHash,
      qualificationRunId: args.qualificationRunId,
    })
  } catch (error) {
    await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(id)}`, {
      status: 'failed',
    }).catch(() => {})
    throw error
  }

  const cleanups: Array<() => Promise<void>> = []
  try {
    const reference = await makeLiveReplayRunner(args.referenceVersionId)
    cleanups.push(reference.cleanup)
    const candidate = await makeLiveReplayRunner(args.candidateVersionId)
    cleanups.push(candidate.cleanup)
    const record = await runReplayComparison({
      copilotId: args.copilotId,
      referenceVersionId: args.referenceVersionId,
      candidateVersionId: args.candidateVersionId,
      inputs: args.inputs,
      runReference: reference.run,
      runCandidate: candidate.run,
    })
    if ((await readVersionStage(args.candidateVersionId)) === 'archived') {
      throw new Error('candidate was archived during replay execution')
    }
    const costs = record.cases.flatMap((item) => [item.reference.costUsd, item.candidate.costUsd])
    await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(id)}`, {
      status: verdictToStatus(record.verdict),
      case_count: record.caseCount,
      verdict: record.verdict,
      cost_usd: totalMeasuredCost(costs),
      candidates: record.cases.map((item) => ({
        comparison: item.comparison,
        note: item.note,
        reference: item.reference,
        candidate: item.candidate,
      })),
    })
    await emitReplayTelemetry({
      eventType: 'replay_completed',
      copilotId: args.copilotId,
      candidateVersionId: args.candidateVersionId,
      comparisonId: id,
      verdict: record.verdict,
      provider: candidateExec.modelProvider,
      model: candidateExec.model,
      contentHash: args.contentHash,
      qualificationRunId: args.qualificationRunId,
    })
    return { evidenceId: id, verdict: record.verdict }
  } catch (error) {
    console.error('[shadow-replay-driver] replay execution failed', {
      comparisonId: id,
      qualificationRunId: args.qualificationRunId,
      error: error instanceof Error ? error.message : 'unknown error',
    })
    await pgrest('PATCH', `replay_comparisons?id=eq.${encodeURIComponent(id)}`, {
      status: 'failed',
    }).catch(() => {})
    throw error
  } finally {
    for (const cleanup of cleanups) await cleanup().catch(() => {})
  }
}

export function createShadowReplayDriver(): ShadowReplayDriver {
  return { runShadow, runReplay }
}
