/**
 * Unit tests for the sandbox report store
 * (src/lib/agent-mission-control/sandbox-reports-store.ts).
 *
 * Pure, offline: pgrest is mocked. Asserts persist maps the core columns, latest
 * returns the newest row, and a stored report round-trips through the schema
 * validator (no secret value ever reaches the row — the report is pre-sanitized).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type PgrestCall = { method: string; path: string; body?: unknown }
let calls: PgrestCall[]
let getResponse: unknown[]

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body })
    return method === 'GET' ? getResponse : undefined
  }),
}))

import { persistSandboxReport, getLatestSandboxReport } from '@/lib/agent-mission-control/sandbox-reports-store'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'

function report(overrides: Partial<TargetRepoSandboxReport> = {}): TargetRepoSandboxReport {
  return {
    schemaVersion: 1,
    runId: 'sandbox_r1',
    agentSlug: 'repo-inspector',
    copilotId: 'copilot-x',
    versionId: 'v-x',
    repo: 'adrien-debug/TradeAgent',
    branch: 'main',
    commit: 'abc1234',
    executionMode: 'execute',
    installMode: 'auto',
    sandboxKept: false,
    status: 'passed',
    repoFitScore: 78,
    sandboxFitScore: 100,
    checks: [{ id: 'script:typecheck', label: 'npm run typecheck', status: 'passed', durationMs: 1200, outputExcerpt: 'ok' }],
    artifacts: {},
    warnings: [],
    blockers: [],
    createdAt: '2026-07-16T06:00:00Z',
    ...overrides,
  }
}

describe('persistSandboxReport', () => {
  beforeEach(() => {
    calls = []
    getResponse = []
  })

  it('2 — maps the core fields into flat columns + full report jsonb', async () => {
    await persistSandboxReport(report(), 'proj-tradeagent')
    const insert = calls.find((c) => c.method === 'POST' && c.path === 'sandbox_reports')!
    const body = insert.body as Record<string, unknown>
    expect(body.id).toBe('sandbox_r1')
    expect(body.copilot_id).toBe('copilot-x')
    expect(body.project_id).toBe('proj-tradeagent')
    expect(body.target_repo).toBe('adrien-debug/TradeAgent')
    expect(body.execution_mode).toBe('execute')
    expect(body.install_mode).toBe('auto')
    expect(body.status).toBe('passed')
    expect(body.sandbox_fit_score).toBe(100)
    expect(body.repo_fit_score).toBe(78)
    expect(body.report).toBeDefined()
  })

  it('9/10 — no secret value is stored (the report is pre-sanitized)', async () => {
    // A report whose excerpt was sanitized upstream carries *** not the value.
    await persistSandboxReport(
      report({ checks: [{ id: 'script:typecheck', label: 'x', status: 'passed', durationMs: 1, outputExcerpt: 'GITHUB_TOKEN=***' }] }),
      null
    )
    const body = calls[0].body as Record<string, unknown>
    expect(JSON.stringify(body)).not.toContain('ghp_')
    expect(JSON.stringify(body)).toContain('***')
  })
})

describe('getLatestSandboxReport', () => {
  beforeEach(() => {
    calls = []
    getResponse = []
  })

  it('3 — returns the newest report (query orders by created_at desc, limit 1)', async () => {
    getResponse = [{ report: report({ runId: 'newest' }) }]
    const r = await getLatestSandboxReport('copilot-x')
    expect(r?.runId).toBe('newest')
    const get = calls.find((c) => c.method === 'GET')!
    expect(get.path).toContain('order=created_at.desc')
    expect(get.path).toContain('limit=1')
  })

  it('null when no report exists', async () => {
    getResponse = []
    expect(await getLatestSandboxReport('copilot-x')).toBeNull()
  })

  it('null (not a crash) when a stored row fails schema validation', async () => {
    getResponse = [{ report: { schemaVersion: 99, runId: 'bad' } }]
    expect(await getLatestSandboxReport('copilot-x')).toBeNull()
  })
})
