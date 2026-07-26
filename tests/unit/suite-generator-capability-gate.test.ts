/**
 * A generated case must be passable by the agent it is generated FOR.
 *
 * The repo-aware generator instructions carried unconditional quotas: "if
 * riskNotes mention a tracked .env … AT LEAST ONE case where the agent
 * identifies secret exposure risk", "if scripts exist … AT LEAST ONE case that
 * the agent proposes REAL validation commands", and so on. Those quotas fired on
 * the REPO's signals alone and never looked at what the agent could actually do.
 *
 * Measured 2026-07-26 on the first post-reset agent, ETH Market Analyst — six
 * market-data tools, zero repo-reading tools. Case 4 of 4 asked it to audit the
 * repository for secret-exposure risk and name real validation scripts. Its
 * reply: "I don't have any repo access tools in this session, and my available
 * tools are ETH market data only" — accurate, honest, and the ONLY thing it
 * could truthfully say. Graded FAIL. A quarter of that agent's pass rate was
 * decided by a question it was structurally unable to answer.
 *
 * A case an agent cannot pass BY BEHAVING CORRECTLY does not measure the agent.
 * It measures the mismatch between the case and the toolbelt, and it drags a
 * healthy pass rate down — the same class of lying metric as the judge defects
 * in judge-calibration.ts, arriving one stage earlier in the pipeline.
 *
 * Pure and OFFLINE — asserts on the prompt text the generator sends.
 */
import { describe, expect, it } from 'vitest'

import { REPO_AWARE_INSTRUCTIONS } from '@/lib/agent-mission-control/repo-suite-context'
import { buildGeneratorRequest } from '@/lib/agent-mission-control/agent-suite-generator'

const REPO_CTX = {
  stack: ['next', 'typescript'],
  scripts: ['check', 'lint', 'test'],
  apiRoutes: ['/api/agent-ops/copilots'],
  riskNotes: ['a tracked .env file is present'],
  designSystemSignals: ['catalyst'],
  envSignals: ['.env'],
  residue: [],
} as unknown as Parameters<typeof buildGeneratorRequest>[0]['repoContext']

describe('the repo-risk quotas are gated on capability', () => {
  it('tells the generator to read mountedTools before demanding repo findings', () => {
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/CAPABILITY FIRST/i)
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/mountedTools/)
  })

  it('names the repo-reading tools whose absence disables the quotas', () => {
    // Naming them is what makes the rule checkable by the model instead of a
    // vague "if it can read the repo".
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/read_repo_file/)
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/list_repo_tree/)
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/search_repo/)
  })

  it('forbids a case requiring repo findings from a repo-blind agent', () => {
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/do NOT write a case that requires repo findings/i)
  })

  it('scopes the MUST-include quotas to agents that hold repo tools', () => {
    // The quotas still exist — an agent WITH repo tools must still be probed on
    // .env risk and residue. The fix narrows who they apply to, it does not
    // delete the coverage.
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/apply ONLY to an agent that actually holds repo tools/i)
    expect(REPO_AWARE_INSTRUCTIONS).toMatch(/AT LEAST ONE case where the agent identifies secret/i)
  })
})

describe('the instruction actually reaches the generator', () => {
  it('appends the repo-aware block, capability gate included, when a repo context exists', () => {
    const { system, userPayload } = buildGeneratorRequest({
      name: 'ETH Market Analyst',
      description: 'Ethereum spot specialist.',
      systemPromptSummary: 'You are ETH Market Analyst.',
      forbiddenActions: ['place order'],
      toolNames: ['read_market_snapshot', 'read_volatility_state'],
      repoContext: REPO_CTX,
    })

    expect(system).toContain('CAPABILITY FIRST')
    // The gate is worthless if the model cannot see the toolbelt it must check.
    expect(userPayload.mountedTools).toEqual(['read_market_snapshot', 'read_volatility_state'])
  })

  it('leaves a manifest-only generation untouched (no repo context, no quotas)', () => {
    const { system, suiteSource } = buildGeneratorRequest({
      name: 'Bench Agent',
      description: 'x',
      systemPromptSummary: 'y',
      forbiddenActions: [],
      toolNames: ['read_market_snapshot'],
      repoContext: null,
    })

    expect(suiteSource).toBe('manifest_only')
    expect(system).not.toContain('CAPABILITY FIRST')
  })
})
