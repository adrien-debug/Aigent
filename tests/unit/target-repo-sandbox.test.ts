/**
 * Unit tests for the Target Repo Sandbox pure evaluator
 * (src/lib/agent-mission-control/target-repo-sandbox.ts).
 *
 * Pure, offline: no GitHub, no clone, no FS. Everything is fed as already-read
 * text. Asserts the artifact checks, secret scan (names only), script detection
 * (never invents), sandboxFitScore, status, and report schema.
 */
import { describe, expect, it } from 'vitest'

import {
  evaluateSandbox,
  parseSandboxReport,
  sanitizeOutput,
  scanSecrets,
  SANDBOX_SCHEMA_VERSION,
  type SandboxEvalInput,
} from '@/lib/agent-mission-control/target-repo-sandbox'

const SLUG = 'repo-inspector'

function registry(slugs: string[], source: 'aigent' | 'other' = 'aigent'): string {
  return JSON.stringify(
    slugs.map((slug) => ({ slug, name: slug, version: 'v0.1.0', model: 'gpt-5.4', runtime: 'openai-assistants', source, pushedAt: '2026-07-16T00:00:00Z', manifestPath: `agents/${slug}/manifest.json` }))
  )
}

const validManifest = JSON.stringify({ systemPromptSummary: 'read-only', confirmationPolicy: 'risky-only', toolIds: ['t1'] })

function base(overrides: Partial<SandboxEvalInput> = {}): SandboxEvalInput {
  return {
    runId: 'sandbox_test',
    agentSlug: SLUG,
    copilotId: 'copilot-x',
    versionId: 'v-x',
    repo: 'adrien-debug/TradeAgent',
    branch: 'main',
    commit: 'abc123',
    repoFitScore: 70,
    registryText: registry([SLUG]),
    manifestText: validManifest,
    handlerPresent: true,
    readmePresent: true,
    targetScripts: { typecheck: 'tsc --noEmit', build: 'next build' },
    artifactTexts: { 'agents/repo-inspector/manifest.json': validManifest },
    createdAt: '2026-07-16T00:00:00Z',
    ...overrides,
  }
}

describe('scanSecrets', () => {
  it('flags a hardcoded ASSIGNMENT, returning the NAME never the value', () => {
    const hits = scanSecrets('const OPENAI_API_KEY = "sk-realvalue1234567"')
    expect(hits).toContain('OPENAI_API_KEY')
    expect(hits.join()).not.toContain('sk-realvalue1234567') // value never surfaced
  })
  it('does NOT flag a bare process.env read (correct wiring, not a leak)', () => {
    expect(scanSecrets('const k = process.env.OPENAI_API_KEY')).toEqual([])
  })
  it('does NOT flag a prose mention in docs', () => {
    expect(scanSecrets('This agent reads its OPENAI_API_KEY from the environment.')).toEqual([])
  })
  it('returns [] when clean', () => {
    expect(scanSecrets('export function handle(){ return 42 }')).toEqual([])
  })
})

describe('evaluateSandbox — artifacts', () => {
  it('1 — registry with agent present → registry checks pass', () => {
    const r = evaluateSandbox(base())
    expect(r.checks.find((c) => c.id === 'artifact:registry')!.status).toBe('passed')
    expect(r.checks.find((c) => c.id === 'artifact:registry-entry')!.status).toBe('passed')
    expect(r.blockers).not.toContain('agent_absent_from_registry')
  })

  it('2 — registry missing agent → blocker', () => {
    const r = evaluateSandbox(base({ registryText: registry(['some-other-agent']) }))
    expect(r.checks.find((c) => c.id === 'artifact:registry-entry')!.status).toBe('failed')
    expect(r.blockers).toContain('agent_absent_from_registry')
    expect(r.status).toBe('failed')
  })

  it('2b — registry absent entirely → agent_not_pushed blocker', () => {
    const r = evaluateSandbox(base({ registryText: null }))
    expect(r.blockers).toContain('agent_not_pushed_to_target_repo')
    expect(r.status).toBe('failed')
  })

  it('3 — manifest missing → blocker', () => {
    const r = evaluateSandbox(base({ manifestText: null }))
    expect(r.blockers).toContain('manifest_missing')
    expect(r.status).toBe('failed')
  })

  it('3b — manifest present but invalid JSON → blocker', () => {
    const r = evaluateSandbox(base({ manifestText: '{ not json' }))
    expect(r.blockers).toContain('manifest_invalid_json')
  })

  it('4 — script detection does not invent scripts', () => {
    const r = evaluateSandbox(base({ targetScripts: { typecheck: 'tsc' } }))
    // typecheck exists → dry_run; build/lint/verify absent → script_missing.
    expect(r.checks.find((c) => c.id === 'script:typecheck')!.reason).toBe('dry_run')
    expect(r.checks.find((c) => c.id === 'script:build')!.reason).toBe('script_missing')
    // No script:* check is ever "passed" in dry-run (they're detected, not run).
    expect(r.checks.filter((c) => c.id.startsWith('script:')).every((c) => c.status === 'skipped')).toBe(true)
  })

  it('5 — missing script → skipped with script_missing', () => {
    const r = evaluateSandbox(base({ targetScripts: {} }))
    expect(r.checks.find((c) => c.id === 'script:verify')!.status).toBe('skipped')
    expect(r.checks.find((c) => c.id === 'script:verify')!.reason).toBe('script_missing')
  })

  it('6 — secret scan flags key NAMES without values', () => {
    const leaky = 'GITHUB_TOKEN=ghp_realtokenvalue123'
    const r = evaluateSandbox(base({ artifactTexts: { 'agents/repo-inspector/handler.ts': leaky } }))
    const sec = r.checks.find((c) => c.id === 'security:secret-scan')!
    expect(sec.status).toBe('failed')
    expect(sec.reason).toContain('GITHUB_TOKEN')
    expect(sec.reason).not.toContain('ghp_realtokenvalue123') // value never surfaced
    expect(r.blockers).toContain('secret_in_artifacts')
  })

  it('7 — status failed when a blocker exists', () => {
    const r = evaluateSandbox(base({ manifestText: null }))
    expect(r.status).toBe('failed')
  })

  it('8 — status warning when only a non-critical check fails', () => {
    const r = evaluateSandbox(base({ handlerPresent: false, readmePresent: false }))
    expect(r.blockers).toEqual([])
    expect(r.warnings).toContain('handler_missing')
    expect(r.warnings).toContain('readme_missing')
    expect(r.status).toBe('warning')
  })

  it('9 — report validates schemaVersion=1', () => {
    const r = evaluateSandbox(base())
    expect(r.schemaVersion).toBe(SANDBOX_SCHEMA_VERSION)
    // Round-trips through the parser without throwing.
    expect(() => parseSandboxReport(JSON.parse(JSON.stringify(r)))).not.toThrow()
  })

  it('9b — parseSandboxReport rejects a bad schema', () => {
    expect(() => parseSandboxReport({ schemaVersion: 2 })).toThrow(/schemaVersion/)
    expect(() => parseSandboxReport(null)).toThrow()
  })

  it('10 — sandboxFitScore computes from applicable (non-skipped) checks', () => {
    const clean = evaluateSandbox(base())
    // All artifact/security checks pass, scripts are skipped (excluded) → 100.
    expect(clean.sandboxFitScore).toBe(100)
    const degraded = evaluateSandbox(base({ handlerPresent: false }))
    expect(degraded.sandboxFitScore).toBeLessThan(100)
    expect(degraded.sandboxFitScore).toBeGreaterThan(0)
  })

  it('registry source not aigent → warning, not a blocker', () => {
    const r = evaluateSandbox(base({ registryText: registry([SLUG], 'other') }))
    expect(r.warnings).toContain('registry_source_not_aigent')
    expect(r.blockers).toEqual([])
  })
})

describe('evaluateSandbox — execute mode (script results injected)', () => {
  it('dry_run default: scripts stay skipped/dry_run (Prompt 48 unchanged)', () => {
    const r = evaluateSandbox(base())
    expect(r.executionMode).toBe('dry_run')
    expect(r.installMode).toBe('skip')
    expect(r.sandboxKept).toBe(false)
    expect(r.checks.find((c) => c.id === 'script:typecheck')!.reason).toBe('dry_run')
  })

  it('execute: a present script with a passed result → passed + durationMs + excerpt', () => {
    const r = evaluateSandbox(
      base({
        executionMode: 'execute',
        installMode: 'auto',
        scriptResults: { typecheck: { status: 'passed', durationMs: 1234, outputExcerpt: 'ok' } },
      })
    )
    const check = r.checks.find((c) => c.id === 'script:typecheck')!
    expect(check.status).toBe('passed')
    expect(check.durationMs).toBe(1234)
    expect(check.outputExcerpt).toBe('ok')
    expect(r.executionMode).toBe('execute')
  })

  it('execute: a failed result → failed check', () => {
    const r = evaluateSandbox(
      base({ executionMode: 'execute', scriptResults: { typecheck: { status: 'failed', durationMs: 5, outputExcerpt: 'error TS1' } } })
    )
    expect(r.checks.find((c) => c.id === 'script:typecheck')!.status).toBe('failed')
  })

  it('execute: a timed-out result → failed + script_timeout blocker + status failed', () => {
    const r = evaluateSandbox(
      base({ executionMode: 'execute', scriptResults: { build: { status: 'failed', durationMs: 120000, outputExcerpt: '', timedOut: true } } })
    )
    expect(r.checks.find((c) => c.id === 'script:build')!.reason).toBe('timeout')
    expect(r.blockers).toContain('script_timeout:build')
    expect(r.status).toBe('failed')
  })

  it('execute: coveredByVerify scripts are skipped/covered_by_verify', () => {
    const r = evaluateSandbox(
      base({
        executionMode: 'execute',
        targetScripts: { verify: 'x', typecheck: 'tsc', build: 'next build' },
        scriptResults: { verify: { status: 'passed', durationMs: 100, outputExcerpt: 'all green' } },
        coveredByVerify: ['typecheck', 'build'],
      })
    )
    expect(r.checks.find((c) => c.id === 'script:verify')!.status).toBe('passed')
    expect(r.checks.find((c) => c.id === 'script:typecheck')!.reason).toBe('covered_by_verify')
  })

  it('execute: a secret VALUE in output is masked in the excerpt', () => {
    const r = evaluateSandbox(
      base({
        executionMode: 'execute',
        scriptResults: { typecheck: { status: 'passed', durationMs: 1, outputExcerpt: 'GITHUB_TOKEN=ghp_supersecretvalue123' } },
      })
    )
    const excerpt = r.checks.find((c) => c.id === 'script:typecheck')!.outputExcerpt!
    expect(excerpt).not.toContain('ghp_supersecretvalue123')
    expect(excerpt).toContain('***')
  })

  it('absent scripts stay skipped even in execute mode', () => {
    const r = evaluateSandbox(base({ executionMode: 'execute', targetScripts: { typecheck: 'tsc' }, scriptResults: { typecheck: { status: 'passed', durationMs: 1, outputExcerpt: 'ok' } } }))
    expect(r.checks.find((c) => c.id === 'script:build')!.reason).toBe('script_missing')
  })
})

describe('sanitizeOutput', () => {
  it('masks a KEY/TOKEN/SECRET/PASSWORD assigned value', () => {
    expect(sanitizeOutput('OPENAI_API_KEY=sk-realvalue123')).not.toContain('sk-realvalue123')
    expect(sanitizeOutput('PASSWORD: hunter2secret')).toContain('***')
  })
  it('masks credentials embedded in a URL', () => {
    expect(sanitizeOutput('cloning https://user:tok3nvalue@github.com/x/y')).not.toContain('tok3nvalue')
  })
  it('masks a Bearer token', () => {
    expect(sanitizeOutput('Authorization: Bearer abc123def456')).not.toContain('abc123def456')
  })
  it('truncates beyond the excerpt cap', () => {
    const long = 'x'.repeat(9000)
    const out = sanitizeOutput(long)
    expect(out.length).toBeLessThan(9000)
    expect(out).toContain('truncated')
  })
})
