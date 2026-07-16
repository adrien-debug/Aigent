/**
 * Unit tests for BTC runtime quality manifest + delivery readiness gates.
 */
import { describe, expect, it } from 'vitest'

import {
  BTC_V3_FORBIDDEN_ACTIONS,
  BTC_V3_OUTPUT_INVARIANTS,
  BTC_V3_SYSTEM_PROMPT_SUMMARY,
  btcV3ManifestPatch,
} from '@/lib/agent-mission-control/btc-runtime-manifest'
import { composeSystemPrompt } from '@/lib/agent-mission-control/copilot-behavior'
import { evaluateReadiness } from '@/lib/agent-mission-control/delivery-loop'
import type { TargetRepoSandboxReport } from '@/lib/agent-mission-control/target-repo-sandbox'

describe('btcV3ManifestPatch', () => {
  const patch = btcV3ManifestPatch()

  it('1 — refuses write tool creation', () => {
    expect(patch.forbiddenActions.some((a) => /write-capable tools/i.test(a))).toBe(true)
  })

  it('2 — refuses auto-promotion', () => {
    expect(patch.forbiddenActions.some((a) => /auto-promote/i.test(a))).toBe(true)
  })

  it('3 — requires NO_ALERT/WATCH/ALERT_CANDIDATE verdict', () => {
    expect(patch.outputContractInvariants.some((i) => /NO_ALERT.*WATCH.*ALERT_CANDIDATE/i.test(i))).toBe(true)
  })

  it('4 — states no write/execution happened', () => {
    expect(patch.outputContractInvariants.some((i) => /no execution\/write/i.test(i))).toBe(true)
  })

  it('5 — handles tracked .env without leaking values', () => {
    expect(BTC_V3_SYSTEM_PROMPT_SUMMARY).toMatch(/REFUSE.*sans appeler aucun outil/i)
    expect(patch.forbiddenActions.some((a) => /\.env/i.test(a))).toBe(true)
    expect(patch.outputContractInvariants.some((i) => /never cite or display secret/i.test(i))).toBe(true)
  })

  it('6 — handles residue without auto-delete', () => {
    expect(patch.outputContractInvariants.some((i) => /review-before-delete/i.test(i))).toBe(true)
    expect(BTC_V3_FORBIDDEN_ACTIONS.some((a) => /auto-delete residue/i.test(a))).toBe(true)
  })

  it('7 — does not invent API routes', () => {
    expect(patch.outputContractInvariants.some((i) => /refuse to invent absent endpoints/i.test(i))).toBe(true)
  })

  it('8 — handles DS/Catalyst honestly', () => {
    expect(patch.outputContractInvariants.some((i) => /never invent check:ds/i.test(i))).toBe(true)
    expect(patch.outputContractInvariants.some((i) => /Tailwind.*globals\.css/i.test(i))).toBe(true)
  })

  it('composeSystemPrompt carries forbidden actions and invariants', () => {
    const prompt = composeSystemPrompt({
      copilotName: 'BTC Alert & Levels Sentinel',
      manifest: {
        system_prompt_summary: BTC_V3_SYSTEM_PROMPT_SUMMARY,
        forbidden_actions: [...BTC_V3_FORBIDDEN_ACTIONS],
        output_contract: { format: 'markdown', schemaName: null, invariants: [...BTC_V3_OUTPUT_INVARIANTS] },
      },
      confirmationPolicy: 'risky-only',
    })
    expect(prompt).toContain('You must never:')
    expect(prompt).toMatch(/\.env/i)
    expect(prompt).toMatch(/NO_ALERT/)
  })
})

describe('evaluateReadiness — runtime quality gates', () => {
  function greenReport(): TargetRepoSandboxReport {
    return {
      schemaVersion: 1,
      runId: 'sandbox_x',
      agentSlug: 'btc-alert',
      copilotId: 'copilot-x',
      versionId: 'v-x',
      repo: 'adrien-debug/TradeAgent',
      branch: 'main',
      commit: 'abc',
      executionMode: 'execute',
      installMode: 'auto',
      sandboxKept: false,
      status: 'passed',
      repoFitScore: 100,
      sandboxFitScore: 100,
      checks: [],
      artifacts: {},
      warnings: [],
      blockers: [],
      createdAt: '2026-07-16T00:00:00Z',
    }
  }

  const base = {
    deliveryMode: 'pull_request' as const,
    prUrl: 'https://github.com/adrien-debug/TradeAgent/pull/3',
    report: greenReport(),
    reportPersisted: true,
    scorecardLevel: 'excellent' as const,
    executeStatus: 'passed' as const,
    toolFitStatus: 'pass' as const,
    repoFitMissingCoverage: [] as string[],
    testPassRate: 1,
    benchmarkUnsafeActions: 0,
    releaseGatePromotable: true,
    repoFitScore: 100,
  }

  it('9 — ready requires tests 100% and unsafe_actions 0', () => {
    expect(evaluateReadiness(base).ready).toBe(true)
    const badTests = evaluateReadiness({ ...base, testPassRate: 0.4 })
    expect(badTests.ready).toBe(false)
    expect(badTests.unmet.some((u) => u.includes('test pass rate'))).toBe(true)
    const badBench = evaluateReadiness({ ...base, benchmarkUnsafeActions: 1 })
    expect(badBench.ready).toBe(false)
    expect(badBench.unmet.some((u) => u.includes('unsafe_actions'))).toBe(true)
  })

  it('10 — ready_for_manual_test requires release gate green', () => {
    const r = evaluateReadiness({ ...base, releaseGatePromotable: false })
    expect(r.ready).toBe(false)
    expect(r.unmet).toContain('release gate is not green')
  })
})
