/**
 * Unit tests for the live delivery loop brain
 * (src/lib/agent-mission-control/delivery-loop.ts). Pure, offline.
 *
 * Covers: sandbox failure classification (Aigent-side vs target-repo), the
 * install-mode retry recommendation, and the strict ready-for-manual-test gate.
 */
import { describe, expect, it } from 'vitest'

import { classifySandbox, evaluateReadiness } from '@/lib/agent-mission-control/delivery-loop'
import type { SandboxCheck, TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'

function report(overrides: Partial<TargetRepoSandboxReport> = {}): TargetRepoSandboxReport {
  return {
    schemaVersion: 1,
    runId: 'sandbox_x',
    agentSlug: 'btc-alert',
    copilotId: 'copilot-x',
    versionId: 'v-x',
    repo: 'adrien-debug/TradeAgent',
    branch: 'main',
    commit: 'abc123',
    executionMode: 'execute',
    installMode: 'skip',
    sandboxKept: false,
    status: 'failed',
    repoFitScore: 78,
    sandboxFitScore: 60,
    checks: [],
    artifacts: {},
    warnings: [],
    blockers: [],
    createdAt: '2026-07-16T06:00:00Z',
    ...overrides,
  }
}

function scriptCheck(id: string, status: 'passed' | 'failed', output = ''): SandboxCheck {
  return { id, label: `npm run ${id.replace('script:', '')}`, status, outputExcerpt: output }
}

describe('classifySandbox', () => {
  it('1 — handler typecheck failure (deps present) → HANDLER_TYPECHECK_FAILURE, aigent-fixable', () => {
    const r = report({
      installMode: 'auto',
      checks: [scriptCheck('script:typecheck', 'failed', "agents/btc-alert/handler.ts(25,18): error TS2322: Type 'x'")],
    })
    const c = classifySandbox(r)
    expect(c.failureClass).toBe('HANDLER_TYPECHECK_FAILURE')
    expect(c.aigentFixable).toBe(true)
  })

  it('2 — registry missing → REGISTRY_FAILURE, aigent-fixable', () => {
    const c = classifySandbox(report({ blockers: ['agent_not_pushed_to_target_repo'] }))
    expect(c.failureClass).toBe('REGISTRY_FAILURE')
    expect(c.aigentFixable).toBe(true)
  })

  it('3 — manifest invalid → MANIFEST_FAILURE, aigent-fixable', () => {
    const c = classifySandbox(report({ blockers: ['manifest_invalid_json'] }))
    expect(c.failureClass).toBe('MANIFEST_FAILURE')
    expect(c.aigentFixable).toBe(true)
  })

  it('4 — installMode skip dependency error → TARGET_REPO_DEPENDENCY_MISSING, recommends auto', () => {
    const r = report({
      installMode: 'skip',
      checks: [scriptCheck('script:typecheck', 'failed', "error TS2580: Cannot find name 'process'. Do you need to install type definitions for node?")],
    })
    const c = classifySandbox(r)
    expect(c.failureClass).toBe('TARGET_REPO_DEPENDENCY_MISSING')
    expect(c.aigentFixable).toBe(false)
    expect(c.recommendation).toMatch(/installMode: auto/)
  })

  it('5 — target repo existing failure (deps present, not the handler) → not blamed on agent', () => {
    const r = report({
      installMode: 'auto',
      checks: [scriptCheck('script:test', 'failed', 'src/app/(auth)/auth-form.tsx: assertion failed in the repo’s own code')],
    })
    const c = classifySandbox(r)
    expect(c.failureClass).toBe('TARGET_REPO_EXISTING_FAILURE')
    expect(c.aigentFixable).toBe(false)
    expect(c.recommendation).toMatch(/Not an agent defect/)
  })

  it('secret leak → SECRET_SCAN_FAILURE, aigent-fixable', () => {
    const r = report({ blockers: ['secret_in_artifacts'], checks: [{ id: 'security:secret-scan', label: 'x', status: 'failed', reason: 'secret_pattern_in:agents/btc-alert/handler.ts:GITHUB_TOKEN' }] })
    const c = classifySandbox(r)
    expect(c.failureClass).toBe('SECRET_SCAN_FAILURE')
    expect(c.aigentFixable).toBe(true)
  })

  it('timeout → SCRIPT_TIMEOUT', () => {
    const c = classifySandbox(report({ blockers: ['script_timeout:build'] }))
    expect(c.failureClass).toBe('SCRIPT_TIMEOUT')
  })
})

describe('evaluateReadiness', () => {
  function greenReport(): TargetRepoSandboxReport {
    return report({
      status: 'passed',
      sandboxFitScore: 100,
      blockers: [],
      warnings: [],
      checks: [scriptCheck('script:typecheck', 'passed', 'ok')],
    })
  }

  it('6 — all green → ready_for_manual_test', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/7',
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
    })
    expect(r.ready).toBe(true)
    expect(r.status).toBe('ready_for_manual_test')
    expect(r.unmet).toEqual([])
  })

  it('8 — missing PR URL blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: null,
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet).toContain('a PR URL is required')
  })

  it('9 — un-persisted report blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/7',
      report: greenReport(),
      reportPersisted: false,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet).toContain('the sandbox report must be persisted')
  })

  it('low sandbox score (< 95) blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/7',
      report: report({ status: 'passed', sandboxFitScore: 80, blockers: [] }),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet.some((u) => u.includes('sandboxFitScore'))).toBe(true)
  })

  it('execute failed blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/7',
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'failed',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet).toContain('sandbox execute failed')
  })

  it('scorecard below delivery_ready blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/7',
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'safe',
      executeStatus: 'passed',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet).toContain('delivery scorecard below delivery_ready')
  })

  it('tool-fit fail blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/2',
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
      toolFitStatus: 'fail',
    })
    expect(r.ready).toBe(false)
    expect(r.unmet.some((u) => u.includes('tool-fit'))).toBe(true)
  })

  it('risk coverage missing blocks readiness', () => {
    const r = evaluateReadiness({
      deliveryMode: 'pull_request',
      prUrl: 'https://github.com/owner/repo/pull/2',
      report: greenReport(),
      reportPersisted: true,
      scorecardLevel: 'excellent',
      executeStatus: 'passed',
      toolFitStatus: 'pass',
      repoFitMissingCoverage: ['secrets', 'repo_risks'],
    })
    expect(r.ready).toBe(false)
    expect(r.unmet.some((u) => u.includes('risk coverage missing'))).toBe(true)
  })
})
