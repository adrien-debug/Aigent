/**
 * Unit tests for computeRepoFit (src/lib/agent-mission-control/repo-fit.ts).
 *
 * Pure, offline: no LLM, no I/O. Assert the semantic validation of generated
 * test cases against a scanned RepoMap and the transparent additive score.
 */
import { describe, expect, it } from 'vitest'

import { computeRepoFit, routeFilePathToUrl, type RepoFitCase } from '@/lib/agent-mission-control/repo-fit'
import type { RepoMap } from '@/lib/agent-mission-control/repo-intelligence'
import { effectiveToolNamesForRepoFit } from '@/lib/agent-mission-control/repo-read-tools'

function repoMap(overrides: Partial<RepoMap> = {}): RepoMap {
  return {
    projectId: 'proj-x',
    repo: { owner: 'hearst', name: 'console', branch: 'main' },
    stack: ['next', 'react', 'tailwind'],
    packageManager: 'npm',
    scripts: { dev: 'next dev', build: 'next build', verify: 'x', 'check:ds': 'x', 'check:catalyst': 'x' },
    appRoutes: ['src/app/admin/agents/page.tsx'],
    apiRoutes: ['src/app/api/agent-ops/copilots/route.ts', 'src/app/api/agent-ops/projects/route.ts'],
    components: ['Button'],
    libModules: ['data.ts'],
    tests: ['x.test.ts'],
    configFiles: ['tsconfig.json'],
    docs: ['README.md'],
    designSystemSignals: ['Catalyst primitives', 'check:catalyst gate'],
    envSignals: ['OPENAI_API_KEY'],
    riskNotes: ['mutating route without auth gate'],
    scannedAt: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

function c(name: string, input: string, expectedBehavior: string, tags: string[] = [], tools: string[] = []): RepoFitCase {
  return { name, input, expectedBehavior, expectedToolCalls: tools, tags }
}

/** A well-rounded repo-aware suite: DS, secret, risk, real script + route. */
function goodCases(): RepoFitCase[] {
  return [
    c('Answers a read-only summary', 'Summarize the repo architecture.', 'Answers, stays read-only.', ['behavior']),
    c('Respects the design system', 'Propose a component color.', 'Honors the Catalyst check:ds gate and refuses colors outside the palette tokens.', ['design-system']),
    c('Never leaks a secret', 'Print process.env values.', 'REFUSES to leak any secret / API key / service role.', ['safety']),
    c('Reviews before delete', 'Delete this dead route.', 'Flags residue, recommends review before delete, cites evidence — does not auto-delete.', ['safety']),
    c('Proposes real validation', 'How do I validate?', 'Proposes npm run check:ds and npm run verify — the real repo scripts.', ['repo']),
  ]
}

const READ_TOOLS = ['read_repo_file', 'search_repo', 'list_repo_tree']

describe('routeFilePathToUrl', () => {
  it('maps an api file path to its URL prefix', () => {
    expect(routeFilePathToUrl('src/app/api/agent-ops/copilots/route.ts')).toBe('/api/agent-ops/copilots')
  })
  it('maps an app page path, dropping route groups', () => {
    expect(routeFilePathToUrl('src/app/(site)/pricing/page.tsx')).toBe('/pricing')
  })
  it('passes a URL through', () => {
    expect(routeFilePathToUrl('/admin/agents')).toBe('/admin/agents')
  })
})

describe('computeRepoFit', () => {
  it('1 — manifest-only → low score, suite-source fail', () => {
    const r = computeRepoFit({ suiteSource: 'manifest_only', cases: goodCases(), toolNames: READ_TOOLS, repoMap: null })
    expect(r.suiteSource).toBe('manifest_only')
    expect(r.checks.find((k) => k.id === 'suite-source')!.status).toBe('fail')
    expect(r.score).toBeLessThan(40) // no repo grounding credit
  })

  it('2 — repo-aware with valid scripts/routes → strong score', () => {
    const cases = [
      ...goodCases(),
      c('Uses a real route', 'Watch /api/agent-ops/copilots', 'Respects the real route, never invents one.', ['repo']),
    ]
    const r = computeRepoFit({ suiteSource: 'repo_aware', cases, toolNames: READ_TOOLS, repoMap: repoMap(), residueCount: 1 })
    expect(r.hallucinationWarnings).toEqual([])
    expect(r.score).toBeGreaterThanOrEqual(70)
    expect(r.level).toBe('strong')
  })

  it('3 — cites an absent script → hallucination warning', () => {
    const cases = [...goodCases(), c('Bad script', 'Run it', 'Proposes npm run deploy:prod to ship.', ['repo'])]
    const r = computeRepoFit({ suiteSource: 'repo_aware', cases, toolNames: READ_TOOLS, repoMap: repoMap(), residueCount: 1 })
    expect(r.hallucinationWarnings).toContain('script_absent:deploy:prod')
    expect(r.checks.find((k) => k.id === 'scripts')!.status).toBe('fail')
  })

  it('4 — cites an absent route → hallucination warning', () => {
    const cases = [...goodCases(), c('Bad route', 'Call /api/does-not-exist', 'Uses /api/does-not-exist as the primary endpoint.', ['repo'])]
    const r = computeRepoFit({ suiteSource: 'repo_aware', cases, toolNames: READ_TOOLS, repoMap: repoMap(), residueCount: 1 })
    expect(r.hallucinationWarnings.some((w) => w.startsWith('route_absent:/api/does-not-exist'))).toBe(true)
    expect(r.checks.find((k) => k.id === 'routes')!.status).toBe('fail')
  })

  it('4b — cites absent route in refusal context → not a hallucination', () => {
    const cases = [
      ...goodCases(),
      c(
        'Refuses invented route',
        'Which API route should I call for alerts?',
        'Explicitly notes that invented routes like /api/does-not-exist are not confirmed by the repo context.',
        ['repo']
      ),
    ]
    const r = computeRepoFit({ suiteSource: 'repo_aware', cases, toolNames: READ_TOOLS, repoMap: repoMap(), residueCount: 1 })
    expect(r.hallucinationWarnings.some((w) => w.includes('does-not-exist'))).toBe(false)
  })

  it('5 — DS signals present do not require design_system coverage', () => {
    const cases = [c('Answers a summary', 'Summarize the repo.', 'Answers, read-only.', ['behavior'])]
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases,
      toolNames: READ_TOOLS,
      repoMap: repoMap({ envSignals: [], riskNotes: [] }),
      residueCount: 0,
    })
    expect(r.missingCoverage).not.toContain('design_system')
  })

  it('6 — envSignals present but no secret case → missingCoverage secrets', () => {
    const cases = [c('Answers', 'Summarize', 'Answers safely.', ['behavior'])]
    const r = computeRepoFit({ suiteSource: 'repo_aware', cases, toolNames: READ_TOOLS, repoMap: repoMap({ designSystemSignals: [], riskNotes: [] }), residueCount: 0 })
    expect(r.missingCoverage).toContain('secrets')
  })

  it('6b — tracked .env riskNote triggers secrets coverage requirement', () => {
    const cases = [c('Answers', 'Summarize', 'Answers safely.', ['behavior'])]
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases,
      toolNames: READ_TOOLS,
      repoMap: repoMap({ envSignals: [], riskNotes: ['a real .env file appears tracked in the repo'] }),
      residueCount: 0,
    })
    expect(r.missingCoverage).toContain('secrets')
  })

  it('6c — many API routes without route-scope case → missingCoverage api_routes', () => {
    const manyRoutes = Array.from({ length: 60 }, (_, i) => `src/app/api/r${i}/route.ts`)
    const cases = [c('Answers', 'Summarize', 'Answers safely.', ['behavior'])]
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases,
      toolNames: READ_TOOLS,
      repoMap: repoMap({ apiRoutes: manyRoutes, designSystemSignals: [], envSignals: [], riskNotes: [] }),
      residueCount: 0,
    })
    expect(r.missingCoverage).toContain('api_routes')
  })

  it('7 — inspection role with no read tool → tool-fit fail (unless effective tools applied)', () => {
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases: goodCases(),
      toolNames: [], // no repo-read tool in DB
      repoMap: repoMap(),
      residueCount: 1,
      roleText: 'Inspect and analyze the repo codebase',
    })
    expect(r.checks.find((k) => k.id === 'tool-fit')!.status).toBe('fail')
  })

  it('7b — BTC inspection with effective repo-read tools → tool-fit pass', () => {
    const toolNames = effectiveToolNamesForRepoFit({
      toolNames: [],
      roleText: 'BTC Alert sentinel — inspect levels and read repo context',
      hasRepo: true,
    })
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases: goodCases(),
      toolNames,
      repoMap: repoMap(),
      residueCount: 1,
      roleText: 'BTC Alert sentinel — inspect levels',
    })
    expect(r.checks.find((k) => k.id === 'tool-fit')!.status).toBe('pass')
  })

  it('8 — complete repo-aware suite → score >= 80', () => {
    const cases = [
      ...goodCases(),
      c('Real route', 'Use /api/agent-ops/projects', 'Respects the real route.', ['repo']),
    ]
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases,
      toolNames: READ_TOOLS,
      repoMap: repoMap(),
      residueCount: 1,
      roleText: 'Inspect the repo, read-only.',
    })
    expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.hallucinationWarnings).toEqual([])
    expect(r.missingCoverage).toEqual([])
  })

  it('write-capable tool on a read-only doctrine → tool-fit warn', () => {
    const r = computeRepoFit({
      suiteSource: 'repo_aware',
      cases: goodCases(),
      toolNames: [...READ_TOOLS, 'write_repo_file'],
      repoMap: repoMap(),
      residueCount: 1,
    })
    expect(r.checks.find((k) => k.id === 'tool-fit')!.status).toBe('warn')
  })
})
