/**
 * Unit test for getRegistryKpis (src/lib/agent-mission-control/data.ts).
 *
 * Pure, offline: pgrest is mocked. Proves the dette fix reaches the dashboard
 * KPI — avgTestPassRate is computed from RUN-BACKED health (copilots that have
 * a completed run), never by averaging the stale zero blobs, and a copilot
 * serving a production version counts as active even though its stored `status`
 * column still reads draft.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestHandler = (method: string, path: string) => unknown

let pgrestHandler: PgrestHandler

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string) => pgrestHandler(method, path)),
  // camelRow/camelRows are used by data.ts too — re-export the real impls.
  camelRow: (row: Record<string, unknown>) => camelReal(row),
  camelRows: (rows: Record<string, unknown>[]) => rows.map(camelReal),
}))

// Minimal snake→camel for the two fields the KPI touches on our fixtures.
function camelReal<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    const ck = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
    out[ck] = v
  }
  return out as T
}

import { getRegistryKpis } from '@/lib/agent-mission-control/data'

/**
 * Two copilots: "measured" has a completed test run (pass_rate 1); "draft" has
 * none. Both carry the OLD stale blob health.test_pass_rate = 0 in the copilots
 * row — the fix must ignore that and derive from runs.
 */
function installKpiMocks() {
  const measured = {
    id: 'copilot-measured',
    name: 'Measured',
    status: 'draft',
    production_version_id: 'v-prod', // serving production despite draft status
    health: { test_pass_rate: 0, benchmark_score: 0, runs_last24h: 3, error_rate_last24h: 0, avg_latency_ms: 0, cost_last24h_usd: 0.05, open_warnings: 0 },
  }
  const draft = {
    id: 'copilot-draft',
    name: 'Draft',
    status: 'draft',
    production_version_id: null,
    health: { test_pass_rate: 0, benchmark_score: 0, runs_last24h: 0, error_rate_last24h: 0, avg_latency_ms: 0, cost_last24h_usd: 0, open_warnings: 0 },
  }

  pgrestHandler = (_m, path) => {
    if (path.startsWith('copilots?')) return [measured, draft]
    if (path.startsWith('test_runs?')) {
      // Only "copilot-measured" has a completed run.
      if (path.includes(encodeURIComponent('copilot-measured')))
        return [{ id: 'tr', copilot_id: 'copilot-measured', pass_rate: 1, started_at: '2026-07-15T10:00:00Z' }]
      return []
    }
    if (path.startsWith('benchmark_runs?')) return []
    if (path.startsWith('benchmark_results?')) return []
    throw new Error(`Unmocked pgrest path: ${path}`)
  }
}

describe('getRegistryKpis', () => {
  beforeEach(() => {
    installKpiMocks()
  })

  it('avgTestPassRate uses run-backed health, not the stale zero blobs', async () => {
    const kpis = await getRegistryKpis()
    // Only the measured copilot counts; its real pass rate is 1 (100%).
    expect(kpis.avgTestPassRate).toBe(1)
    expect(kpis.totalCopilots).toBe(2)
  })

  it('a copilot serving production counts as active via displayStatus', async () => {
    const kpis = await getRegistryKpis()
    // "copilot-measured" has production_version_id → displayStatus production →
    // counted active, even though its stored status column is draft.
    expect(kpis.activeCopilots).toBe(1)
  })
})
