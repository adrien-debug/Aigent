/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the DETERMINISTIC (fixture) execution adapter.
 *
 * Drop-in for the live adapter that produces REPRODUCIBLE evidence with NO billed
 * LLM call. It runs each scripted scenario through the copilot's real ground-truth
 * machinery: a "count-words" scenario executes the REAL certified `count_words`
 * tool (the same single-source impl the shadow/replay fixtures use), so the tool
 * calls it reports are genuine, not asserted. What it replaces is only the two
 * billed legs — the model-driven agent reply and the LLM judge — with a scripted,
 * self-consistent pair. It generalises `makeFixtureShadowAgent` from
 * promotion-fixtures.ts to the test/benchmark runners.
 *
 * Honest by construction:
 *   - cost is a real 0 — no provider was billed, so it is not a fabricated 0;
 *   - it can ONLY execute a CERTIFIED tool. Asked to run an uncertified/unknown
 *     tool it REFUSES (records a 'rejected' call, never executes it) — the same
 *     fail-closed stance the runtime guardrail takes;
 *   - it labels itself `deterministic-fixture`, which flows into the persisted
 *     `execution_mode` column, so its rows can never be mistaken for a billed run;
 *   - it can be CONSTRUCTED only where the guard allows (never in production).
 *
 * It is NOT server-only: it reads no secret and reaches no network, so a proof
 * script (tsx) can import it directly.
 */
import { countWords } from '../tool-builder/tools/count-words'
import { isToolCertified } from '../registry/tools'
import {
  EVIDENCE_MODE_DB_LABEL,
  type AgentLegRequest,
  type AgentLegResult,
  type EvidenceExecutionAdapter,
  type JudgeLegRequest,
  type JudgeLegResult,
} from './execution-adapter'
import {
  assertDeterministicEvidenceAllowed,
  type DeterministicActivationSource,
} from './guard'

/**
 * What the fixture agent does for one input. Each maps to a distinct evidence
 * shape the runners must handle: a green pass, a wrong result, a tool error, a
 * timeout, an attempt to run an uncertified tool, or a plain no-tool reply.
 */
export type FixtureAgentBehavior =
  | { kind: 'count-words' } // run real count_words, report the true count → green
  | { kind: 'wrong-answer'; reportedWords?: number } // run count_words, report a WRONG count → red
  | { kind: 'tool-error'; message?: string } // count_words came back status:'error'
  | { kind: 'timeout' } // the agent leg throws → runner records an 'error' outcome
  | { kind: 'uncertified-tool'; toolName: string } // attempt a non-certified tool → refused, never executed
  | { kind: 'plain'; reply: string } // no tool, a plain reply

/**
 * The scripted grade for a scenario. Rendered into the strict-JSON shape the
 * calling runner expects (test vs benchmark). Because the same scenario also
 * controls the agent output, the pair is internally consistent — a fixture, never
 * a claim about a real model.
 */
export interface FixtureGrade {
  /** Behavioural verdict. */
  pass: boolean
  reason?: string
  /** Benchmark accuracy 0..1 — defaults to 1 on pass, 0 on fail. */
  accuracy?: number
  /** Attempted a forbidden/unsafe action. Default false. */
  unsafe?: boolean
  /** Acted on a route outside the allowed list (benchmark only). Default false. */
  unauthorizedRoute?: boolean
  /** false ONLY when a required confirmation was skipped. Default true. */
  confirmationHonored?: boolean
}

/** One fully-scripted case, keyed by the exact input text the runner will send. */
export interface FixtureScenario {
  input: string
  behavior: FixtureAgentBehavior
  grade: FixtureGrade
}

/** Injected certification oracle (default: the canonical registry). Mirrors shadow.ts's lookup seam. */
export type CertificationLookup = (toolName: string) => boolean

export interface DeterministicAdapterConfig {
  scenarios: ReadonlyArray<FixtureScenario>
  /** Why the adapter is being built — recorded on a refusal, never used to decide. */
  source?: DeterministicActivationSource
  /** Override the certified-tool oracle (tests prove the known-but-uncertified refusal). */
  certificationLookup?: CertificationLookup
  /** Env override for the guard (tests simulate production). */
  env?: Record<string, string | undefined>
}

const COUNT_WORDS_TOOL = 'count_words'

function scenarioFor(map: Map<string, FixtureScenario>, input: string): FixtureScenario {
  const scenario = map.get(input)
  if (!scenario) {
    // Fail-closed: a deterministic run must have a scripted answer for every
    // input it is asked to run. A silent default would let an unscripted case
    // sneak through as a fabricated pass.
    throw new Error(`deterministic fixture: no scenario scripted for input ${JSON.stringify(input)}`)
  }
  return scenario
}

function runAgentBehavior(
  scenario: FixtureScenario,
  input: string,
  isCertified: CertificationLookup
): AgentLegResult {
  const b = scenario.behavior
  switch (b.kind) {
    case 'count-words': {
      // REAL certified tool execution — the reported count is measured, not asserted.
      const r = countWords(input)
      return {
        toolCalls: [{ toolName: COUNT_WORDS_TOOL, status: 'ok' }],
        reply: `The text contains ${r.words} words (${r.characters} characters).`,
        pausedForConfirmation: false,
        pendingToolName: null,
        costUsd: 0,
      }
    }
    case 'wrong-answer': {
      const r = countWords(input)
      const reported = b.reportedWords ?? r.words + 1 // deliberately wrong
      return {
        toolCalls: [{ toolName: COUNT_WORDS_TOOL, status: 'ok' }],
        reply: `The text contains ${reported} words.`,
        pausedForConfirmation: false,
        pendingToolName: null,
        costUsd: 0,
      }
    }
    case 'tool-error': {
      return {
        toolCalls: [{ toolName: COUNT_WORDS_TOOL, status: 'error' }],
        reply: `The ${COUNT_WORDS_TOOL} tool failed: ${b.message ?? 'tool execution error'}.`,
        pausedForConfirmation: false,
        pendingToolName: null,
        costUsd: 0,
      }
    }
    case 'timeout': {
      // The agent leg never completed — the runner catches this and records an
      // 'error' outcome (test) / a dead, ineligible task (benchmark).
      throw new Error(`deterministic fixture: simulated timeout on input ${JSON.stringify(input)}`)
    }
    case 'uncertified-tool': {
      // FAIL-CLOSED: the deterministic adapter executes CERTIFIED tools only. An
      // uncertified/unknown tool is REFUSED — recorded as attempted-and-rejected,
      // never run. This is the fixture complement of "run real certified tools".
      if (isCertified(b.toolName)) {
        // Defensive: the scenario asked to prove a refusal, but the tool is
        // actually certified — that is a scripting error, surfaced loudly.
        throw new Error(
          `deterministic fixture: 'uncertified-tool' scenario names '${b.toolName}', which IS certified`
        )
      }
      return {
        toolCalls: [{ toolName: b.toolName, status: 'rejected' }],
        reply: `Refused to run '${b.toolName}': it is not a certified tool.`,
        pausedForConfirmation: false,
        pendingToolName: null,
        costUsd: 0,
      }
    }
    case 'plain': {
      return {
        toolCalls: [],
        reply: b.reply,
        pausedForConfirmation: false,
        pendingToolName: null,
        costUsd: 0,
      }
    }
  }
}

function renderJudge(request: JudgeLegRequest, grade: FixtureGrade): JudgeLegResult {
  if (request.purpose === 'test') {
    // Shape consumed by safeParseGrade (test-runner.ts).
    let reason = grade.reason
    if (!reason) reason = grade.pass ? 'meets expected behaviour' : 'does not meet expected behaviour'
    const text = JSON.stringify({
      verdict: grade.pass ? 'pass' : 'fail',
      reason,
      observedToolCalls: [],
      unsafeAttempt: grade.unsafe ?? false,
      confirmationHonored: grade.confirmationHonored ?? true,
    })
    return { text, costUsd: 0 }
  }
  // Shape consumed by safeParseBenchGrade (benchmark-runner.ts).
  const text = JSON.stringify({
    success: grade.pass,
    accuracy: grade.accuracy ?? (grade.pass ? 1 : 0),
    unsafeAction: grade.unsafe ?? false,
    unauthorizedRoute: grade.unauthorizedRoute ?? false,
    confirmationMistake: grade.confirmationHonored === false,
  })
  return { text, costUsd: 0 }
}

/**
 * Build a deterministic evidence adapter from a fixture script. Throws
 * `DeterministicEvidenceForbiddenError` if constructed outside a recognised
 * non-production context (see guard.ts) — so a fixture can never be activated in
 * production, whatever asked for it.
 */
export function makeDeterministicEvidenceAdapter(
  config: DeterministicAdapterConfig
): EvidenceExecutionAdapter {
  // Guard FIRST: no deterministic adapter exists in a forbidden context.
  assertDeterministicEvidenceAllowed(config.source ?? 'test', config.env)

  const map = new Map<string, FixtureScenario>()
  for (const s of config.scenarios) map.set(s.input, s)
  const isCertified = config.certificationLookup ?? isToolCertified

  return {
    mode: 'deterministic',
    label: EVIDENCE_MODE_DB_LABEL.deterministic,
    async executeAgent(request: AgentLegRequest): Promise<AgentLegResult> {
      const scenario = scenarioFor(map, request.input)
      return runAgentBehavior(scenario, request.input, isCertified)
    },
    async judge(request: JudgeLegRequest): Promise<JudgeLegResult> {
      const input = typeof request.payload.input === 'string' ? request.payload.input : ''
      const scenario = scenarioFor(map, input)
      return renderJudge(request, scenario.grade)
    },
  }
}
