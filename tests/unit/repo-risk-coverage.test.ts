/**
 * Unit tests for repo risk coverage (repo-risk-coverage.ts).
 */
import { describe, expect, it } from 'vitest'

import {
  assessRiskCoverage,
  buildDeterministicRiskCases,
  requiredRiskCoverageKeys,
  riskCoverageRetryPrompt,
} from '@/lib/agent-mission-control/repo-risk-coverage'
import type { RepoMap } from '@/lib/agent-mission-control/repo-intelligence'
import { buildRepoSuiteContext } from '@/lib/agent-mission-control/repo-suite-context'

function tradeAgentMap(): RepoMap {
  return {
    projectId: 'proj-ta',
    repo: { owner: 'adrien-debug', name: 'TradeAgent', branch: 'main' },
    stack: ['next', 'react'],
    packageManager: 'npm',
    scripts: { test: 'vitest', build: 'next build', 'check:catalyst': 'x' },
    appRoutes: Array.from({ length: 10 }, (_, i) => `src/app/p${i}/page.tsx`),
    apiRoutes: Array.from({ length: 60 }, (_, i) => `src/app/api/r${i}/route.ts`),
    components: [],
    libModules: [],
    tests: [],
    configFiles: [],
    docs: [],
    designSystemSignals: ['Catalyst primitives', 'check:catalyst gate'],
    envSignals: ['OPENAI_API_KEY'],
    riskNotes: ['a real .env file appears tracked in the repo — review for secret exposure'],
    scannedAt: '2026-07-16T00:00:00Z',
  }
}

function tradeAgentIntelligence() {
  return {
    map: tradeAgentMap(),
    footprint: { hasAgenticCode: false, frameworks: [], graphs: [], tools: [], manifests: [], prompts: [], evals: [], runners: [], routes: [], risks: [], residueSignals: [] },
    residue: Array.from({ length: 8 }, (_, i) => ({
      severity: 'medium' as const,
      type: 'dead_route' as const,
      path: `src/old/${i}.ts`,
      evidence: 'unreferenced',
      recommendedAction: 'review before delete',
    })),
    recommendations: [],
  }
}

const repoCtx = buildRepoSuiteContext(tradeAgentIntelligence())!

describe('requiredRiskCoverageKeys — TradeAgent profile', () => {
  it('requires secrets, repo_risks, api_routes and design_system', () => {
    const keys = requiredRiskCoverageKeys({ repoCtx, repoMap: tradeAgentMap(), residueCount: 8 })
    expect(keys).toEqual(expect.arrayContaining(['secrets', 'repo_risks', 'api_routes', 'design_system']))
  })
})

describe('assessRiskCoverage', () => {
  it('.env tracked riskNotes → secrets required', () => {
    const keys = requiredRiskCoverageKeys({
      repoCtx: { ...repoCtx, envSignals: [] },
      repoMap: tradeAgentMap(),
      residueCount: 0,
    })
    expect(keys).toContain('secrets')
  })

  it('residueFindings → repo_risks required', () => {
    expect(requiredRiskCoverageKeys({ repoCtx, repoMap: tradeAgentMap(), residueCount: 8 })).toContain('repo_risks')
  })

  it('many API routes → api_routes required', () => {
    expect(requiredRiskCoverageKeys({ repoCtx, repoMap: tradeAgentMap(), residueCount: 0 })).toContain('api_routes')
  })

  it('DS signals → design_system required', () => {
    expect(requiredRiskCoverageKeys({ repoCtx, repoMap: tradeAgentMap(), residueCount: 0 })).toContain('design_system')
  })
})

describe('buildDeterministicRiskCases', () => {
  const mounted = new Set(['read_repo_file', 'search_repo', 'list_repo_tree'])

  it('generates secret exposure case for tracked .env', () => {
    const cases = buildDeterministicRiskCases({
      agentName: 'BTC Alert',
      missing: ['secrets'],
      mountedTools: mounted,
      repoCtx,
    })
    expect(cases[0].name.toLowerCase()).toMatch(/secret|\.env/)
    expect(cases[0].expectedBehavior.toLowerCase()).toMatch(/refus|never/)
  })

  it('generates review-before-delete case for residue', () => {
    const cases = buildDeterministicRiskCases({
      agentName: 'BTC Alert',
      missing: ['repo_risks'],
      mountedTools: mounted,
      repoCtx,
    })
    expect(cases[0].expectedBehavior.toLowerCase()).toMatch(/review before delete/)
  })

  it('generates no-route-hallucination case', () => {
    const cases = buildDeterministicRiskCases({
      agentName: 'BTC Alert',
      missing: ['api_routes'],
      mountedTools: mounted,
      repoCtx,
    })
    expect(cases[0].expectedBehavior.toLowerCase()).toMatch(/invent/)
  })

  it('generates design-system case when DS signals present', () => {
    const cases = buildDeterministicRiskCases({
      agentName: 'BTC Alert',
      missing: ['design_system'],
      mountedTools: mounted,
      repoCtx,
    })
    expect(cases[0].expectedBehavior.toLowerCase()).toMatch(/catalyst|check:ds/)
  })
})

describe('assessRiskCoverage — missing stays signalled', () => {
  it('flags risk_coverage_missing when cases do not cover secrets', () => {
    const r = assessRiskCoverage({
      cases: [{ name: 'Basic', input: 'hi', expectedBehavior: 'answers', tags: [] }],
      repoCtx,
      repoMap: tradeAgentMap(),
      residueCount: 8,
    })
    expect(r.missing.length).toBeGreaterThan(0)
  })
})

describe('riskCoverageRetryPrompt', () => {
  it('mentions each missing dimension (max 1 retry instruction)', () => {
    const p = riskCoverageRetryPrompt(['secrets', 'repo_risks'])
    expect(p).toContain('secrets')
    expect(p).toContain('repo_risks')
    expect(p).toContain('RISK COVERAGE INCOMPLETE')
  })
})
