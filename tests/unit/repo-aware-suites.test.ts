/**
 * Unit tests for repo-aware suite generation
 * (repo-suite-context.ts + buildGeneratorRequest from agent-suite-generator.ts).
 *
 * Pure, offline: no PostgREST, no GitHub, no LLM. These assert the CONTEXT and
 * the PROMPT the generator builds from a scanned repo intelligence bundle — not
 * the LLM output. The doctrine under test: repo signals ground the tests, the
 * manifest-only path is unchanged, and nothing is fabricated.
 */
import { describe, expect, it } from 'vitest'

import { buildGeneratorRequest } from '@/lib/agent-mission-control/agent-suite-generator'
import {
  buildRepoSuiteContext,
  repoContextPayload,
  suiteSourceFor,
} from '@/lib/agent-mission-control/repo-suite-context'
import type { RepoIntelligence } from '@/lib/agent-mission-control/repo-intelligence'

// A realistic Next.js repo intelligence bundle (API routes, DS gate, env, residue).
function nextRepoIntelligence(): RepoIntelligence {
  return {
    map: {
      projectId: 'proj-x',
      repo: { owner: 'hearst', name: 'console', branch: 'main' },
      stack: ['next', 'react', 'tailwind', 'typescript'],
      packageManager: 'npm',
      scripts: { dev: 'next dev', 'check:ds': 'node scripts/check-palette.mjs', 'check:catalyst': 'node scripts/check-catalyst.mjs', test: 'vitest run' },
      appRoutes: ['/admin', '/admin/agents'],
      apiRoutes: ['/api/agent-ops/copilots', '/api/agent-ops/projects'],
      components: ['Button', 'Table'],
      libModules: ['data.ts'],
      tests: ['tests/unit/x.test.ts'],
      configFiles: ['tsconfig.json'],
      docs: ['README.md'],
      designSystemSignals: ['Catalyst primitives', 'check:catalyst gate'],
      envSignals: ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
      riskNotes: ['mutating API routes without auth gate', 'secrets referenced in env'],
      scannedAt: '2026-07-16T00:00:00Z',
    },
    footprint: {
      hasAgenticCode: true,
      frameworks: ['langgraph'],
      graphs: ['agent_builder'],
      tools: [],
      manifests: [],
      prompts: [],
      evals: [],
      runners: [],
      routes: [],
      risks: [],
      residueSignals: [],
    },
    residue: [
      { severity: 'high', type: 'dead_route', path: 'src/app/api/old/route.ts', evidence: 'unreferenced', recommendedAction: 'review before delete' },
    ],
    recommendations: [],
  }
}

const manifestCtx = {
  name: 'Repo Inspector',
  description: 'Read-only repo analysis',
  systemPromptSummary: 'Inspect the repo, never write.',
  forbiddenActions: ['write to repo'],
  toolNames: ['read_repo_file', 'search_repo'],
}

describe('buildRepoSuiteContext', () => {
  it('extracts bounded signals from a scanned bundle', () => {
    const ctx = buildRepoSuiteContext(nextRepoIntelligence())
    expect(ctx).not.toBeNull()
    expect(ctx!.stack).toContain('next')
    expect(ctx!.scripts).toContain('check:catalyst') // script NAMES, not commands
    expect(ctx!.apiRoutes).toContain('/api/agent-ops/copilots')
    expect(ctx!.designSystemSignals.length).toBeGreaterThan(0)
    expect(ctx!.envSignals).toContain('OPENAI_API_KEY')
    expect(ctx!.riskNotes.length).toBeGreaterThan(0)
    expect(ctx!.residue[0].type).toBe('dead_route')
    expect(ctx!.hasAgenticCode).toBe(true)
  })

  it('returns null for a missing bundle → manifest-only fallback', () => {
    expect(buildRepoSuiteContext(null)).toBeNull()
    expect(buildRepoSuiteContext(undefined)).toBeNull()
  })

  it('returns null for an all-empty repo (no signal to ground on)', () => {
    const empty = nextRepoIntelligence()
    empty.map.stack = []
    empty.map.scripts = {}
    empty.map.appRoutes = []
    empty.map.apiRoutes = []
    empty.map.designSystemSignals = []
    empty.map.envSignals = []
    empty.map.riskNotes = []
    empty.residue = []
    expect(buildRepoSuiteContext(empty)).toBeNull()
  })

  it('caps every list to its budget — never aspirates the repo', () => {
    const big = nextRepoIntelligence()
    big.map.apiRoutes = Array.from({ length: 50 }, (_, i) => `/api/r${i}`)
    big.map.stack = Array.from({ length: 50 }, (_, i) => `dep${i}`)
    const ctx = buildRepoSuiteContext(big)!
    expect(ctx.apiRoutes.length).toBeLessThanOrEqual(12)
    expect(ctx.stack.length).toBeLessThanOrEqual(12)
  })
})

describe('suiteSourceFor', () => {
  it('repo_aware with context, manifest_only without', () => {
    expect(suiteSourceFor(buildRepoSuiteContext(nextRepoIntelligence()))).toBe('repo_aware')
    expect(suiteSourceFor(null)).toBe('manifest_only')
  })
})

describe('buildGeneratorRequest — manifest-only path unchanged', () => {
  it('no repo context → no repoContext in payload, base system prompt, manifest_only', () => {
    const req = buildGeneratorRequest({ ...manifestCtx, repoContext: null })
    expect(req.suiteSource).toBe('manifest_only')
    expect(req.userPayload.repoContext).toBeUndefined()
    expect(req.userPayload.mountedTools).toEqual(['read_repo_file', 'search_repo'])
    // Base prompt carries the manifest rules but not the repo-aware addendum.
    expect(req.system).toContain('from its manifest')
    expect(req.system).not.toContain('REPO CONTEXT')
  })
})

describe('buildGeneratorRequest — repo-aware path', () => {
  const repoContext = buildRepoSuiteContext(nextRepoIntelligence())

  it('injects the bounded repo context and the repo-aware instructions', () => {
    const req = buildGeneratorRequest({ ...manifestCtx, repoContext })
    expect(req.suiteSource).toBe('repo_aware')
    const payload = req.userPayload.repoContext as Record<string, unknown>
    expect(payload).toBeDefined()
    // Real scripts/routes are present so the LLM can ground tests on them.
    expect(payload.scripts).toContain('check:catalyst')
    expect(payload.apiRoutes).toContain('/api/agent-ops/copilots')
    expect(payload.envSignals).toContain('OPENAI_API_KEY')
    // The system prompt now demands repo-grounded + no-invention.
    expect(req.system).toContain('REPO CONTEXT')
    expect(req.system).toContain('never invent routes, scripts')
    expect(req.system).toContain('design-system gate')
    expect(req.system).toContain('REFUSES to read/display .env values')
    expect(req.system).toContain('tracked .env')
    expect(req.system).toContain('review-before-delete')
  })

  it('repoContextPayload carries only bounded, secret-free signal lists', () => {
    const payload = repoContextPayload(repoContext)!
    // Signal NAMES only (env var names to refuse leaking), never values.
    expect(Object.keys(payload).sort()).toEqual(
      ['apiRoutes', 'appRoutes', 'designSystemSignals', 'envSignals', 'hasAgenticCode', 'residue', 'riskNotes', 'scripts', 'stack'].sort()
    )
    // No script COMMANDS leaked — names only.
    expect(JSON.stringify(payload)).not.toContain('next dev')
  })
})
