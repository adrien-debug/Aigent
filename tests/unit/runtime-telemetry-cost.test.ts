/**
 * Unit tests for the runtime-telemetry cost computation added to
 * src/lib/agent-mission-control/runtime-telemetry-store.ts.
 *
 * Covers the gap the audit flagged: the ingestion route accepts a telemetry
 * provider enum (openai/gemini/custom/unknown) that does NOT match the
 * internal `ModelProvider` union (openai/google/mistral/local) expected by
 * `computeCostUsd` — `gemini` !== `google`. Without an explicit mapping, cost
 * for every Gemini-backed agent would be wrong or silently absent.
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 */
import { describe, expect, it, vi } from 'vitest'

const PROJECT_ID = 'project-cost-test'
const AGENT_ID = 'agent-cost-test'

type PgrestHandler = (method: string, path: string, body?: unknown) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => pgrestHandler(method, path, body)),
}))

import { computeCostUsd } from '@/lib/agent-mission-control/model-pricing'
import {
  normalizeTelemetryProviderToModelProvider,
  summarizeFleetRuntimeTelemetry,
  summarizeRuntimeTelemetry,
} from '@/lib/agent-mission-control/runtime-telemetry-store'

/** Builds a raw (snake_case) row as PostgREST would echo it back. */
function rawRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'event-1',
    project_id: PROJECT_ID,
    agent_id: AGENT_ID,
    agent_version: null,
    target_repo: null,
    run_id: 'run-1',
    provider: 'openai',
    model: 'gpt-5.4',
    status: 'completed',
    latency_ms: 120,
    input_shape: {},
    output_shape: {},
    error: {},
    usage: {},
    environment: {},
    received_at: '2026-07-16T00:00:00.000Z',
    ...overrides,
  }
}

describe('normalizeTelemetryProviderToModelProvider', () => {
  it('is the identity on already-normalized values (rows written post-ingestion-normalization)', () => {
    expect(normalizeTelemetryProviderToModelProvider('google')).toBe('google')
    expect(normalizeTelemetryProviderToModelProvider('local')).toBe('local')
  })

  it('maps openai -> openai', () => {
    expect(normalizeTelemetryProviderToModelProvider('openai')).toBe('openai')
  })

  it('maps gemini -> google (the bug this fix closes)', () => {
    expect(normalizeTelemetryProviderToModelProvider('gemini')).toBe('google')
  })

  it('does NOT guess a mapping for custom', () => {
    expect(normalizeTelemetryProviderToModelProvider('custom')).toBeNull()
  })

  it('does NOT guess a mapping for unknown', () => {
    expect(normalizeTelemetryProviderToModelProvider('unknown')).toBeNull()
  })

  it('does NOT guess a mapping for null/undefined/garbage', () => {
    expect(normalizeTelemetryProviderToModelProvider(null)).toBeNull()
    expect(normalizeTelemetryProviderToModelProvider(undefined)).toBeNull()
    expect(normalizeTelemetryProviderToModelProvider('anthropic')).toBeNull()
  })
})

describe('summarizeRuntimeTelemetry — cost aggregation', () => {
  it('computes totalCostUsd for an openai row with a full input/output split, matching computeCostUsd directly', async () => {
    pgrestHandler = () => [
      rawRow({ provider: 'openai', model: 'gpt-5.4', usage: { inputTokens: 1000, outputTokens: 500 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    const expected = computeCostUsd('openai', 'gpt-5.4', 1000, 500)
    expect(summary.totalCostUsd).toBeCloseTo(expected, 6)
    expect(summary.costEstimated).toBe(true)
  })

  it('normalizes gemini -> google before pricing (the bug this fix closes)', async () => {
    pgrestHandler = () => [
      rawRow({ provider: 'gemini', model: 'gemini-2.5-pro', usage: { inputTokens: 2000, outputTokens: 1000 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    const expected = computeCostUsd('google', 'gemini-2.5-pro', 2000, 1000)
    expect(expected).toBeGreaterThan(0)
    expect(summary.totalCostUsd).toBeCloseTo(expected, 6)
  })

  it('prices a row already normalized at ingestion (provider stored as `google`)', async () => {
    pgrestHandler = () => [
      rawRow({ provider: 'google', model: 'gemini-2.5-pro', usage: { inputTokens: 2000, outputTokens: 1000 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeCloseTo(computeCostUsd('google', 'gemini-2.5-pro', 2000, 1000), 6)
  })

  it('aggregates a MIX of historical (`gemini`) and normalized (`google`) rows identically', async () => {
    // Backward compatibility: rows written before ingestion normalization still
    // carry the wire word. Both spellings must contribute the same cost.
    pgrestHandler = () => [
      rawRow({ id: 'legacy', provider: 'gemini', model: 'gemini-2.5-pro', usage: { inputTokens: 2000, outputTokens: 1000 } }),
      rawRow({ id: 'new', provider: 'google', model: 'gemini-2.5-pro', usage: { inputTokens: 2000, outputTokens: 1000 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeCloseTo(2 * computeCostUsd('google', 'gemini-2.5-pro', 2000, 1000), 6)
    expect(summary.totalRuns).toBe(2)
  })

  it('sums cost across multiple priceable rows', async () => {
    pgrestHandler = () => [
      rawRow({ id: 'a', provider: 'openai', model: 'gpt-5.4', usage: { inputTokens: 1000, outputTokens: 500 } }),
      rawRow({ id: 'b', provider: 'gemini', model: 'gemini-2.5-flash', usage: { inputTokens: 4000, outputTokens: 2000 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    const expected =
      computeCostUsd('openai', 'gpt-5.4', 1000, 500) + computeCostUsd('google', 'gemini-2.5-flash', 4000, 2000)
    expect(summary.totalCostUsd).toBeCloseTo(expected, 6)
  })

  it('is null (never 0) when provider is custom — unmappable, doctrine: unavailable != zero', async () => {
    pgrestHandler = () => [
      rawRow({ provider: 'custom', model: 'some-self-hosted-model', usage: { inputTokens: 1000, outputTokens: 500 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
    expect(summary.costEstimated).toBe(false)
  })

  it('is null (never 0) when provider is unknown', async () => {
    pgrestHandler = () => [
      rawRow({ provider: 'unknown', model: 'gpt-5.4', usage: { inputTokens: 1000, outputTokens: 500 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
  })

  it('is null when provider is missing entirely (older events, pre-provider field)', async () => {
    pgrestHandler = () => [
      rawRow({ provider: null, model: 'gpt-5.4', usage: { inputTokens: 1000, outputTokens: 500 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
  })

  it('is null when model is missing even though provider maps', async () => {
    pgrestHandler = () => [rawRow({ provider: 'openai', model: null, usage: { inputTokens: 1000, outputTokens: 500 } })]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
  })

  it('is null when only totalTokens is reported without the input/output split (cannot be priced accurately)', async () => {
    pgrestHandler = () => [rawRow({ provider: 'openai', model: 'gpt-5.4', usage: { totalTokens: 1500 } })]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
    // totalTokens rollup is unaffected by the cost gap — still aggregated.
    expect(summary.totalTokens).toBe(1500)
  })

  it('mixes priceable and unpriceable rows: sums only what is knowable, never fabricates the rest', async () => {
    pgrestHandler = () => [
      rawRow({ id: 'priceable', provider: 'openai', model: 'gpt-5.4', usage: { inputTokens: 1000, outputTokens: 500 } }),
      rawRow({ id: 'unpriceable', provider: 'custom', model: 'local-llm', usage: { inputTokens: 1000, outputTokens: 500 } }),
    ]

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    const expected = computeCostUsd('openai', 'gpt-5.4', 1000, 500)
    expect(summary.totalCostUsd).toBeCloseTo(expected, 6)
    expect(summary.costEstimated).toBe(true)
  })

  it('empty event window returns totalCostUsd null and costEstimated false, no throw', async () => {
    pgrestHandler = () => []

    const summary = await summarizeRuntimeTelemetry(PROJECT_ID, AGENT_ID)

    expect(summary.totalCostUsd).toBeNull()
    expect(summary.costEstimated).toBe(false)
  })
})

describe('summarizeFleetRuntimeTelemetry — cost aggregation', () => {
  it('aggregates cost fleet-wide across mixed providers', async () => {
    pgrestHandler = () => [
      rawRow({
        id: 'a1',
        project_id: 'proj-a',
        agent_id: 'agent-a',
        provider: 'openai',
        model: 'gpt-5.4',
        usage: { inputTokens: 1000, outputTokens: 500 },
      }),
      rawRow({
        id: 'b1',
        project_id: 'proj-b',
        agent_id: 'agent-b',
        provider: 'gemini',
        model: 'gemini-2.5-pro',
        usage: { inputTokens: 2000, outputTokens: 1000 },
      }),
      rawRow({
        id: 'c1',
        project_id: 'proj-c',
        agent_id: 'agent-c',
        provider: 'unknown',
        model: 'mystery-model',
        usage: { inputTokens: 5000, outputTokens: 5000 },
      }),
    ]

    const summary = await summarizeFleetRuntimeTelemetry()

    const expected =
      computeCostUsd('openai', 'gpt-5.4', 1000, 500) + computeCostUsd('google', 'gemini-2.5-pro', 2000, 1000)
    expect(summary.totalCostUsd).toBeCloseTo(expected, 6)
    expect(summary.costEstimated).toBe(true)
  })

  it('empty fleet window returns totalCostUsd null, no throw', async () => {
    pgrestHandler = () => []

    const summary = await summarizeFleetRuntimeTelemetry()

    expect(summary.totalCostUsd).toBeNull()
    expect(summary.costEstimated).toBe(false)
  })
})
