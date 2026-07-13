/**
 * Agent Mission Control — deterministic failure diagnosis (pure).
 *
 * The Improvement Loop's FIRST classifier: cheap, rule-based, and it RUNS
 * BEFORE (and overrides) anything the proposer LLM says. Born from the
 * Security Sentinel cycle where a V2 manifest lifted the benchmark +26.8 pts
 * while a GraphRecursionError kept a test red — a failure NO manifest patch
 * can fix. The loop must say so instead of proposing another prompt rewrite.
 *
 * Pure module (no 'server-only', no I/O) so vitest drives it directly —
 * mirrors copilot-behavior.ts. Rules are ordered; the first match wins.
 * A rule hit is authoritative: analyzeAndPropose stamps its category over
 * whatever root cause the LLM narrates for the same case.
 */

export type FailureCategory =
  | 'manifest_prompt'
  | 'tool_policy'
  | 'missing_tool'
  | 'test_expectation'
  | 'judge_issue'
  | 'graph_recursion'
  | 'runtime_limit'
  | 'unknown'

export type RecommendedFixType =
  | 'manifest_patch'
  | 'system_prompt_patch'
  | 'tool_contract_patch'
  | 'test_expected_behavior_patch'
  | 'graph_runtime_patch'
  | 'judge_prompt_patch'
  | 'manual_review'

export interface FailureDiagnosisInput {
  caseId: string
  /** test_results.status — 'fail' | 'error' (passing cases are never diagnosed). */
  status: string
  failureReason: string | null
  actualBehavior: string
  expectedBehavior: string
  expectedToolCalls: string[]
  actualToolCalls: string[]
}

export interface FailureDiagnosis {
  testCaseId: string
  category: FailureCategory
  /** 0..1 — rule hits are high (≥0.7); fallbacks are honest about uncertainty. */
  confidence: number
  evidence: string[]
  recommendedFixType: RecommendedFixType
}

// Signatures of a graph that never reached a stop condition. Matches the real
// LangGraph error ("GraphRecursionError", "Recursion limit of N reached") plus
// the generic loop phrasings the packet lists.
const GRAPH_RECURSION_RE =
  /graphrecursionerror|recursion limit|exceeded recursion|graph loop|repeated (?:agent|tool)[^.]*loop/i

// The graph's own step-budget sentinel (agent-builder-graph.mjs) — the run was
// STOPPED CLEANLY by the runtime budget, which is a runtime ceiling, not a
// behaviour bug.
const RUNTIME_LIMIT_RE = /step budget|maxsteps|max steps[^.]*(?:exhausted|exceeded|reached)/i

// test-runner.ts persists exactly this string when the judge's JSON is unusable.
const JUDGE_UNPARSEABLE = 'grader returned unparseable output'

// test-runner.ts's ground-truth tool gate phrasing — the judge passed or failed
// on behaviour, but the mechanical gate flagged expected tools that never ran.
const TOOLS_NEVER_MADE_RE = /expected tool call\(s\) never made/i

const clip = (s: string, n = 240): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/**
 * Classify ONE failing/error test result. `availableToolNames` is the
 * copilot's mounted tool list (tools table) — what the runtime can actually
 * call, needed to split "tool missing" from "tool unused".
 */
export function diagnoseFailure(input: FailureDiagnosisInput, availableToolNames: string[]): FailureDiagnosis {
  const reason = input.failureReason ?? ''
  const haystack = `${reason} ${input.actualBehavior}`

  // 1. Graph recursion — deterministic, and it PRIMES over any LLM narrative:
  //    no manifest/prompt patch can add a stop condition the graph lacks.
  const recursionMatch = haystack.match(GRAPH_RECURSION_RE)
  if (recursionMatch) {
    return {
      testCaseId: input.caseId,
      category: 'graph_recursion',
      confidence: 0.9,
      evidence: [clip(`matched "${recursionMatch[0]}" in ${reason ? 'failure_reason' : 'actual_behavior'}`), clip(reason || input.actualBehavior)],
      recommendedFixType: 'graph_runtime_patch',
    }
  }

  // 2. Runtime step budget — the graph stopped itself at its ceiling.
  const budgetMatch = haystack.match(RUNTIME_LIMIT_RE)
  if (budgetMatch) {
    return {
      testCaseId: input.caseId,
      category: 'runtime_limit',
      confidence: 0.85,
      evidence: [clip(`matched "${budgetMatch[0]}"`), clip(reason || input.actualBehavior)],
      recommendedFixType: 'graph_runtime_patch',
    }
  }

  // 3. Judge broke — the verdict is noise, fix the judge before the copilot.
  if (reason.includes(JUDGE_UNPARSEABLE)) {
    return {
      testCaseId: input.caseId,
      category: 'judge_issue',
      confidence: 0.9,
      evidence: [clip(reason)],
      recommendedFixType: 'judge_prompt_patch',
    }
  }

  // 4. Expected tools that are not even MOUNTED on the copilot — the test
  //    demands a capability the runtime cannot have; no prompt fixes that.
  if (input.expectedToolCalls.length > 0) {
    const mounted = new Set(availableToolNames)
    const unmountable = input.expectedToolCalls.filter((t) => !mounted.has(t))
    if (unmountable.length > 0) {
      const noToolsAtAll = availableToolNames.length === 0
      return {
        testCaseId: input.caseId,
        // No tools mounted at all → the expectation itself is out of reach for
        // this copilot (test problem); some mounted but not these → the
        // copilot's tool contract is missing a tool.
        category: noToolsAtAll ? 'test_expectation' : 'missing_tool',
        confidence: noToolsAtAll ? 0.75 : 0.85,
        evidence: [
          clip(`expected tool(s) not mounted on the copilot: ${unmountable.join(', ')}`),
          clip(`mounted tools: ${availableToolNames.length > 0 ? availableToolNames.join(', ') : '(none)'}`),
        ],
        recommendedFixType: noToolsAtAll ? 'test_expected_behavior_patch' : 'tool_contract_patch',
      }
    }

    // 5. Tools are mounted but the agent never called them — behaviour, not
    //    capability: the prompt does not push tool use hard enough.
    if (TOOLS_NEVER_MADE_RE.test(reason)) {
      return {
        testCaseId: input.caseId,
        category: 'tool_policy',
        confidence: 0.7,
        evidence: [clip(reason), clip(`mounted tools: ${availableToolNames.join(', ')}`)],
        recommendedFixType: 'system_prompt_patch',
      }
    }
  }

  // 6. Technical error with no recognized signature — do not guess.
  if (input.status === 'error') {
    return {
      testCaseId: input.caseId,
      category: 'unknown',
      confidence: 0.4,
      evidence: [clip(reason || input.actualBehavior || '(no detail)')],
      recommendedFixType: 'manual_review',
    }
  }

  // 7. Plain behavioural fail — the judge compared reply vs expectation and
  //    the reply fell short: the manifest/prompt owns that.
  return {
    testCaseId: input.caseId,
    category: 'manifest_prompt',
    confidence: 0.55,
    evidence: [clip(reason || 'reply did not satisfy the expected behaviour')],
    recommendedFixType: 'manifest_patch',
  }
}

// ---------------------------------------------------------------------------
// Cycle-level rollup — "what should the operator do NEXT".
// ---------------------------------------------------------------------------

/** Priority order: runtime blockers first, cosmetic manifest work last. */
const FIX_PRIORITY: RecommendedFixType[] = [
  'graph_runtime_patch',
  'tool_contract_patch',
  'judge_prompt_patch',
  'test_expected_behavior_patch',
  'system_prompt_patch',
  'manifest_patch',
  'manual_review',
]

export const FIX_TYPE_LABELS: Record<RecommendedFixType, string> = {
  graph_runtime_patch: 'Runtime patch (graph stop condition / recursion budget)',
  tool_contract_patch: 'Tool contract patch (mount the missing tool)',
  judge_prompt_patch: 'Judge prompt patch (grader output unusable)',
  test_expected_behavior_patch: 'Test patch (expectation out of reach for this copilot)',
  system_prompt_patch: 'System prompt patch (push the expected tool use)',
  manifest_patch: 'Manifest patch (behaviour charter)',
  manual_review: 'Manual review',
}

export interface NextRecommendedAction {
  fixType: RecommendedFixType
  label: string
  /** Product sentence, e.g. the "manifest improved but not manifest-solvable" verdict. */
  headline: string
}

/**
 * Roll the per-case diagnoses up into ONE next action. The product sentence
 * the loop owes the operator: when runtime blockers remain, say explicitly
 * that more manifest work will NOT fix them.
 */
export function nextRecommendedAction(diagnoses: FailureDiagnosis[]): NextRecommendedAction | null {
  if (diagnoses.length === 0) return null
  const present = new Set(diagnoses.map((d) => d.recommendedFixType))
  const top = FIX_PRIORITY.find((f) => present.has(f))
  if (!top) return null

  const runtimeBlocked = diagnoses.filter((d) => d.recommendedFixType === 'graph_runtime_patch').length
  const manifestish = diagnoses.some(
    (d) => d.recommendedFixType === 'manifest_patch' || d.recommendedFixType === 'system_prompt_patch'
  )
  const headline =
    top === 'graph_runtime_patch'
      ? runtimeBlocked === diagnoses.length
        ? 'The remaining failure(s) are runtime/graph issues — another manifest patch will not fix them; ship a graph stop-condition/recursion-budget patch.'
        : manifestish
          ? 'The manifest was improved, but the remaining blocker is NOT solvable by manifest alone — it needs a runtime/graph stop-condition patch; keep the manifest work for the behavioural fails only.'
          : 'Runtime/graph blocker detected — fix the graph stop condition before iterating on behaviour.'
      : `Next: ${FIX_TYPE_LABELS[top]}.`

  return { fixType: top, label: FIX_TYPE_LABELS[top], headline }
}
