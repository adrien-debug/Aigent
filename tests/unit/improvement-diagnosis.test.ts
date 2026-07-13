/**
 * Unit tests for the Improvement Loop's deterministic failure classifier
 * (diagnoseFailure / nextRecommendedAction in improvement-diagnosis.ts).
 *
 * The load-bearing case is the REAL Security Sentinel failure from the first
 * live cycle: a GraphRecursionError that a V2 manifest patch could not fix.
 * The classifier must call it `graph_recursion` → `graph_runtime_patch` so the
 * loop stops recommending manifest rewrites for a runtime bug — that exact
 * misclassification is what this module exists to prevent.
 */
import { describe, expect, it } from 'vitest'

import {
  diagnoseFailure,
  hasManifestFixableFailures,
  nextRecommendedAction,
  type FailureDiagnosisInput,
} from '@/lib/agent-mission-control/improvement-diagnosis'

const base: FailureDiagnosisInput = {
  caseId: 'tc-1',
  status: 'fail',
  failureReason: null,
  actualBehavior: '',
  expectedBehavior: 'Suggests safe grep/checks; NEVER reveals secret values.',
  expectedToolCalls: [],
  actualToolCalls: [],
}

// The verbatim failure_reason persisted by the real Security Sentinel run.
const SENTINEL_RECURSION_REASON =
  'Error: {"error":"GraphRecursionError","message":"Recursion limit of 25 reached without hitting a stop condition. ' +
  'You can increase the limit by setting the \\"recursionLimit\\" config key."}'

describe('diagnoseFailure', () => {
  it('classifies the real Security Sentinel GraphRecursionError as graph_recursion', () => {
    const d = diagnoseFailure(
      { ...base, caseId: 'tc-security-sentinel-secret-handling-risk-detection-9ca18e19-1', status: 'error', failureReason: SENTINEL_RECURSION_REASON },
      ['scan_repo_for_secrets']
    )
    expect(d.category).toBe('graph_recursion')
    expect(d.recommendedFixType).toBe('graph_runtime_patch')
    expect(d.confidence).toBeGreaterThanOrEqual(0.85)
    expect(d.evidence.length).toBeGreaterThan(0)
  })

  it('classifies the graph step-budget sentinel as runtime_limit', () => {
    const d = diagnoseFailure(
      { ...base, status: 'fail', actualBehavior: '[STEP_BUDGET_EXHAUSTED] I stopped here: this copilot’s step budget (maxSteps) is exhausted.' },
      []
    )
    expect(d.category).toBe('runtime_limit')
    expect(d.recommendedFixType).toBe('graph_runtime_patch')
  })

  it('classifies an unparseable grader as judge_issue', () => {
    const d = diagnoseFailure({ ...base, status: 'error', failureReason: 'grader returned unparseable output' }, [])
    expect(d.category).toBe('judge_issue')
    expect(d.recommendedFixType).toBe('judge_prompt_patch')
  })

  it('classifies an expected tool that is not mounted as missing_tool', () => {
    const d = diagnoseFailure(
      { ...base, failureReason: 'expected tool call(s) never made: search_repo (actual: none)', expectedToolCalls: ['search_repo'] },
      ['read_repo_file']
    )
    expect(d.category).toBe('missing_tool')
    expect(d.recommendedFixType).toBe('tool_contract_patch')
  })

  it('classifies expected tools on a copilot with NO tools as test_expectation', () => {
    const d = diagnoseFailure({ ...base, expectedToolCalls: ['search_repo'] }, [])
    expect(d.category).toBe('test_expectation')
    expect(d.recommendedFixType).toBe('test_expected_behavior_patch')
  })

  it('classifies mounted-but-unused expected tools as tool_policy', () => {
    const d = diagnoseFailure(
      { ...base, failureReason: 'expected tool call(s) never made: search_repo (actual: none)', expectedToolCalls: ['search_repo'] },
      ['search_repo', 'read_repo_file']
    )
    expect(d.category).toBe('tool_policy')
    expect(d.recommendedFixType).toBe('system_prompt_patch')
  })

  it('falls back to manifest_prompt for a plain behavioural fail', () => {
    const d = diagnoseFailure({ ...base, failureReason: 'missed secret exposure; answered with generic limitations' }, [])
    expect(d.category).toBe('manifest_prompt')
    expect(d.recommendedFixType).toBe('manifest_patch')
  })

  it('falls back to unknown/manual_review for an unrecognized technical error', () => {
    const d = diagnoseFailure({ ...base, status: 'error', failureReason: 'ECONNRESET' }, [])
    expect(d.category).toBe('unknown')
    expect(d.recommendedFixType).toBe('manual_review')
  })
})

describe('hasManifestFixableFailures', () => {
  it('returns false when every failure is a graph/runtime blocker', () => {
    const diagnoses = [
      diagnoseFailure(
        { ...base, caseId: 'tc-1', status: 'error', failureReason: SENTINEL_RECURSION_REASON },
        []
      ),
      diagnoseFailure(
        { ...base, caseId: 'tc-2', status: 'fail', actualBehavior: '[STEP_BUDGET_EXHAUSTED] maxSteps exhausted.' },
        []
      ),
    ]
    expect(hasManifestFixableFailures(diagnoses)).toBe(false)
  })

  it('returns true when at least one failure is manifest-fixable', () => {
    const diagnoses = [
      diagnoseFailure({ ...base, caseId: 'tc-1', status: 'error', failureReason: SENTINEL_RECURSION_REASON }, []),
      diagnoseFailure({ ...base, caseId: 'tc-2', failureReason: 'missed secret exposure' }, []),
    ]
    expect(hasManifestFixableFailures(diagnoses)).toBe(true)
  })
})

describe('nextRecommendedAction', () => {
  it('prioritizes the runtime blocker and says manifest alone will not fix it', () => {
    const diagnoses = [
      diagnoseFailure({ ...base, failureReason: 'missed secret exposure' }, []),
      diagnoseFailure({ ...base, caseId: 'tc-2', status: 'error', failureReason: SENTINEL_RECURSION_REASON }, []),
    ]
    const action = nextRecommendedAction(diagnoses)
    expect(action?.fixType).toBe('graph_runtime_patch')
    expect(action?.headline).toMatch(/NOT solvable by manifest alone/i)
  })

  it('returns null when nothing failed', () => {
    expect(nextRecommendedAction([])).toBeNull()
  })
})
