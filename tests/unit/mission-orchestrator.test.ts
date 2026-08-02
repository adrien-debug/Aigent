/**
 * Unit tests — Multi-Agent Mission Orchestrator (pure + stores + no GitHub write).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AgentDeliveryScorecard } from '@/lib/agent-mission-control/delivery-scorecard'
import type { DeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import {
  assembleMissionReport,
  buildMissionFindings,
  buildQaReleaseFindings,
  buildSecurityFindings,
  computeMissionConsensus,
  selectMissionParticipants,
  type MissionFinding,
  type MissionParticipant,
} from '@/lib/agent-mission-control/mission-orchestrator'
import type { RepoIntelligence } from '@/lib/agent-mission-control/repo-intelligence'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'
import type { Copilot } from '@/lib/agent-mission-control/types'

function copilot(partial: Partial<Copilot> & Pick<Copilot, 'id' | 'name' | 'slug'>): Copilot {
  return {
    projectId: 'proj-trade',
    targetProjectIds: [],
    description: '',
    runtime: 'langgraph',
    status: 'active',
    productionVersionId: null,
    latestVersionId: 'v1',
    model: 'gpt-5.4',
    modelProvider: 'openai',
    owner: 'adrien',
    tags: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    health: {
      testPassRate: 1,
      benchmarkScore: 90,
      runsLast24h: 0,
      costLast24hUsd: 0,
      errorRateLast24h: 0,
      avgLatencyMs: 0,
    },
    ...partial,
  }
}

function baseIntel(overrides?: Partial<RepoIntelligence>): RepoIntelligence {
  return {
    map: {
      projectId: 'proj-trade',
      repo: { owner: 'adrien-debug', name: 'TradeAgent', branch: 'main' },
      stack: ['Next.js', 'TypeScript'],
      packageManager: 'npm',
      scripts: { lint: 'eslint', test: 'vitest', build: 'next build', typecheck: 'tsc' },
      appRoutes: ['/dashboard'],
      apiRoutes: ['/api/signals', '/api/market/prices'],
      components: [],
      libModules: [],
      tests: [],
      configFiles: [],
      docs: [],
      designSystemSignals: [],
      envSignals: [],
      riskNotes: [],
      scannedAt: '2026-07-16T00:00:00Z',
    },
    footprint: {
      hasAgenticCode: true,
      frameworks: [],
      graphs: [],
      tools: [],
      manifests: [],
      prompts: [],
      evals: [],
      runners: [],
      routes: [],
      risks: [],
      residueSignals: [],
    },
    residue: [],
    recommendations: [],
    ...overrides,
  }
}

function scorecard(overrides?: Partial<AgentDeliveryScorecard>): AgentDeliveryScorecard {
  return {
    score: 94,
    level: 'excellent',
    status: 'pass',
    dimensions: [
      { id: 'tests', label: 'Tests', score: 100, status: 'pass', evidence: '100% pass rate' },
      { id: 'benchmark', label: 'Benchmark', score: 71, status: 'pass', evidence: 'score 71' },
      { id: 'release-gate', label: 'Gate', score: 100, status: 'pass' },
    ],
    blockers: [],
    warnings: [],
    target: 'candidate',
    targetVersionId: 'v1',
    productionVersionId: null,
    candidateVersionId: 'v1',
    isProductionServed: false,
    hasDifferentCandidate: false,
    evidence: {
      releaseGatePromotable: true,
      repoFit: {
        score: 100,
        level: 'strong',
        suiteSource: 'repo_aware',
        checks: [],
        missingCoverage: [],
        hallucinationWarnings: [],
      },
    },
    ...overrides,
  }
}

function sandbox(status: TargetRepoSandboxReport['status']): TargetRepoSandboxReport {
  return {
    schemaVersion: 1,
    runId: 'sb1',
    agentSlug: 'btc-alert',
    repo: 'adrien-debug/TradeAgent',
    branch: 'main',
    commit: 'abc',
    executionMode: 'execute',
    installMode: 'auto',
    status,
    sandboxFitScore: status === 'failed' ? 40 : 100,
    repoFitScore: 100,
    blockers: status === 'failed' ? ['script:test failed'] : [],
    warnings: [],
    checks: [{ id: 'security:secret-scan', label: 'secrets', status: 'passed' }],
    artifacts: {},
    sandboxKept: false,
    createdAt: '2026-07-16T00:00:00Z',
  }
}

function participant(role: MissionParticipant['role'], status: 'assigned' | 'missing' = 'assigned'): MissionParticipant {
  return {
    role,
    copilotId: status === 'assigned' ? `copilot-${role}` : null,
    copilotName: role,
    status,
  }
}

describe('selectMissionParticipants', () => {
  it('1 — selects Repo Inspector + Security + QA for any repo mission', () => {
    const p = selectMissionParticipants({
      objective: 'Audit TradeAgent readiness',
      projectCopilots: [],
      repoIntelligence: baseIntel(),
    })
    const roles = p.map((x) => x.role)
    expect(roles).toContain('repo_inspector')
    expect(roles).toContain('security')
    expect(roles).toContain('qa_release')
    expect(roles).not.toContain('design_system' as typeof roles[number])
  })

  it('2 — never selects Design System Guardian (legacy doctrine blocked)', () => {
    const withDs = selectMissionParticipants({
      objective: 'Audit',
      projectCopilots: [],
      repoIntelligence: baseIntel({
        map: { ...baseIntel().map, designSystemSignals: ['Tailwind', 'globals.css'] },
      }),
    })
    const roles = withDs.map((p) => p.role)
    expect(roles).not.toContain('design_system' as typeof roles[number])
  })

  it('3 — selects domain BTC agent for BTC objective', () => {
    const btc = copilot({ id: 'c-btc', name: 'BTC Alert & Levels Sentinel', slug: 'btc-alert-levels' })
    const p = selectMissionParticipants({
      objective: 'Validate BTC Alert after merged delivery',
      projectCopilots: [btc],
      repoIntelligence: baseIntel(),
    })
    const domain = p.find((x) => x.role === 'domain_agent')
    expect(domain).toBeDefined()
    expect(domain?.copilotId).toBe('c-btc')
  })

  it('4 — missing participant becomes warning via findings, not fake success', () => {
    const findings = buildMissionFindings(
      'run1',
      [
        participant('repo_inspector', 'missing'),
        participant('security', 'assigned'),
        participant('qa_release', 'assigned'),
      ],
      { repoIntelligence: baseIntel(), deliveryEvent: null, sandboxReport: null, scorecard: null, projectCopilots: [], domainCopilotId: null }
    )
    expect(findings.some((f) => f.title.includes('Participant missing'))).toBe(true)
  })
})

describe('role findings', () => {
  it('5 — security finding for tracked .env risk', () => {
    const intel = baseIntel({
      map: {
        ...baseIntel().map,
        riskNotes: ['.env file may be tracked in git — rotate secrets'],
        envSignals: ['OPENAI_API_KEY'],
      },
    })
    const findings = buildSecurityFindings('run1', {
      repoIntelligence: intel,
      deliveryEvent: null,
      sandboxReport: null,
      scorecard: null,
      projectCopilots: [],
      domainCopilotId: null,
    }, participant('security'))
    expect(findings.some((f) => /tracked .env|secret exposure/i.test(f.title))).toBe(true)
    expect(findings.some((f) => f.severity === 'warning')).toBe(true)
  })

  it('6 — QA finding for release_gate_red', () => {
    const findings = buildQaReleaseFindings(
      'run1',
      {
        repoIntelligence: null,
        deliveryEvent: null,
        sandboxReport: null,
        scorecard: scorecard({ blockers: ['release_gate_red'], evidence: { releaseGatePromotable: false } }),
        projectCopilots: [],
        domainCopilotId: null,
      },
      participant('qa_release')
    )
    expect(findings.some((f) => f.title === 'Release gate red')).toBe(true)
  })

  it('7 — QA finding for sandbox failed', () => {
    const findings = buildQaReleaseFindings(
      'run1',
      {
        repoIntelligence: null,
        deliveryEvent: null,
        sandboxReport: sandbox('failed'),
        scorecard: null,
        projectCopilots: [],
        domainCopilotId: null,
      },
      participant('qa_release')
    )
    expect(findings.some((f) => f.title === 'Sandbox verdict' && f.severity === 'blocker')).toBe(true)
  })
})

describe('computeMissionConsensus', () => {
  function finding(severity: MissionFinding['severity'], title: string, evidence: Record<string, unknown> = {}): MissionFinding {
    return {
      id: `f-${title}`,
      missionRunId: 'run1',
      copilotId: null,
      role: 'qa_release',
      severity,
      title,
      description: title,
      evidence,
      recommendation: null,
    }
  }

  it('8 — consensus blocker => blocked', () => {
    const c = computeMissionConsensus([finding('blocker', 'Release gate red')])
    expect(c.decision).toBe('blocked')
    expect(c.status).toBe('blocked')
  })

  it('9 — consensus warnings + green scorecard => ready_for_delivery_loop', () => {
    const c = computeMissionConsensus([
      finding('warning', 'Participant missing: Repo Inspector'),
      finding('info', 'Delivery scorecard', { level: 'excellent' }),
    ])
    expect(c.decision).toBe('ready_for_delivery_loop')
    expect(c.status).toBe('ready_for_delivery')
  })

  it('10 — merged_validated delivery event => completed', () => {
    const c = computeMissionConsensus([
      finding('info', 'Merged delivery validated', { deliveryStatus: 'merged_validated' }),
      finding('info', 'Sandbox verdict'),
    ])
    expect(c.status).toBe('completed')
    expect(c.decision).toBe('continue')
  })
})

// ---------------------------------------------------------------------------
// Store + server (mocked pgrest) — tests 11–14
// ---------------------------------------------------------------------------

type Call = { method: string; path: string; body?: unknown }
let calls: Call[]
let getResponse: unknown[]

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body })
    return method === 'GET' ? getResponse : undefined
  }),
}))

vi.mock('@/lib/agent-mission-control/data', () => ({
  getProject: vi.fn(async (id: string) =>
    id === 'proj-trade'
      ? { id, name: 'TradeAgent', slug: 'tradeagent', repoFullName: 'adrien-debug/TradeAgent', platform: 'web' }
      : null
  ),
  getCopilots: vi.fn(async () => [
    copilot({ id: 'c-btc', name: 'BTC Alert & Levels Sentinel', slug: 'btc-alert-levels-sentinel', projectId: 'proj-trade' }),
  ]),
}))

vi.mock('@/lib/agent-mission-control/repo-intelligence-store', () => ({
  loadRepoIntelligence: vi.fn(async () => ({ intelligence: baseIntel(), scannedAt: '2026-01-01', sha: 'x' })),
}))

vi.mock('@/lib/agent-mission-control/delivery-events-store', () => ({
  getLatestDeliveryEvent: vi.fn(async () => ({
    id: 'd1',
    versionId: 'v1',
    mode: 'pull_request',
    targetRepo: 'adrien-debug/TradeAgent',
    targetBranch: 'main',
    deliveryBranch: 'main',
    commitSha: 'abc',
    commitUrl: 'u',
    prUrl: 'https://github.com/adrien-debug/TradeAgent/pull/4',
    prNumber: 4,
    status: 'merged_validated',
    createdAt: '2026-07-16T00:00:00Z',
  } satisfies DeliveryEvent)),
}))

vi.mock('@/lib/agent-mission-control/sandbox-reports-store', () => ({
  getLatestSandboxReport: vi.fn(async () => sandbox('passed')),
}))

vi.mock('@/lib/agent-mission-control/delivery-scorecard-server', () => ({
  getDeliveryScorecard: vi.fn(async () => scorecard()),
}))

vi.mock('@/lib/agent-mission-control/github', () => ({
  pushAgentToRepo: vi.fn(),
  pushAgentToRepoPullRequest: vi.fn(),
}))

import { persistMissionRun } from '@/lib/agent-mission-control/mission-runs-store'
import { persistMissionFindings } from '@/lib/agent-mission-control/mission-findings-store'
import { runMission } from '@/lib/agent-mission-control/mission-orchestrator-server'
import * as github from '@/lib/agent-mission-control/github'

describe('mission persistence', () => {
  beforeEach(() => {
    calls = []
    getResponse = []
    vi.clearAllMocks()
  })

  it('11 — POST mission persists run + findings via stores', async () => {
    const report = assembleMissionReport({
      runId: 'mission_abc123456789',
      projectId: 'proj-trade',
      objective: 'test',
      mode: 'evidence_v1',
      repo: 'adrien-debug/TradeAgent',
      branch: 'main',
      participants: [participant('qa_release')],
      findings: [],
      createdAt: '2026-07-16T00:00:00Z',
    })
    await persistMissionRun({
      id: report.runId,
      projectId: report.projectId,
      objective: report.objective,
      status: report.status,
      participantCopilotIds: [],
      repo: report.repo,
      branch: report.branch,
      decision: report.consensus.decision,
      summary: report.consensus.summary,
      report,
      createdAt: report.createdAt,
      updatedAt: report.createdAt,
    })
    await persistMissionFindings([
      {
        id: 'finding_1',
        missionRunId: report.runId,
        copilotId: null,
        role: 'qa_release',
        severity: 'info',
        title: 't',
        description: 'd',
        evidence: {},
        recommendation: null,
      },
    ])
    expect(calls.some((c) => c.path === 'mission_runs')).toBe(true)
    expect(calls.some((c) => c.path === 'mission_findings')).toBe(true)
  })

  it('12 — GET latest returns newest mission (store query)', async () => {
    getResponse = [
      {
        id: 'mission_latest1234',
        project_id: 'proj-trade',
        objective: 'o',
        status: 'completed',
        participant_copilot_ids: [],
        repo: 'adrien-debug/TradeAgent',
        branch: 'main',
        decision: 'continue',
        summary: 's',
        report: {},
        created_at: '2026-07-16T07:00:00Z',
        updated_at: '2026-07-16T07:00:00Z',
      },
    ]
    const { getLatestMissionRun } = await import('@/lib/agent-mission-control/mission-runs-store')
    const row = await getLatestMissionRun('proj-trade')
    expect(row?.id).toBe('mission_latest1234')
    const get = calls.find((c) => c.method === 'GET')!
    expect(get.path).toContain('order=created_at.desc')
    expect(get.path).toContain('limit=1')
  })

  it('13 — no GitHub write occurs during runMission', async () => {
    await runMission({
      projectId: 'proj-trade',
      objective: 'Validate BTC Alert & Levels Sentinel after merged delivery',
      mode: 'evidence_v1',
    })
    expect(github.pushAgentToRepo).not.toHaveBeenCalled()
    expect(github.pushAgentToRepoPullRequest).not.toHaveBeenCalled()
  })

  it('14 — no merge call exists in orchestrator server module', async () => {
    const src = await import('node:fs/promises').then((fs) =>
      fs.readFile(new URL('../../src/lib/agent-mission-control/mission-orchestrator-server.ts', import.meta.url), 'utf8')
    )
    expect(src).not.toMatch(/pushAgentToRepo|pushAgentToRepoPullRequest/)
  })
})
