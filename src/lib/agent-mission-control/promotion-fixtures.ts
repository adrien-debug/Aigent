/**
 * Deterministic fixture adapters for shadow + replay PROOF without a billed run
 * (AIGENT-RUNTIME-PROMOTION-001, Phase 9).
 *
 * The real runner reaches OpenAI/Google/vLLM (all cost money or a real GPU).
 * To PROVE the shadow/replay/promotion machinery end-to-end deterministically —
 * and to make the non-bypass tests offline — we drive the shadow/replay engines
 * with an INJECTED runAgent built from a SCRIPTED model: for a given input it
 * decides, without any network call, which certified local tool to "call" and
 * with what args. The only tool it calls is `count_words` (a certified
 * local-deterministic tool), so the whole path is real code, real tool
 * execution, zero external effect, and repeatable.
 *
 * A `mutatingProbe: true` input makes the script attempt a MUTATING tool, so a
 * test can assert the shadow gate blocks it (WOULD_MUTATE) and nothing fires.
 *
 * Pure/isomorphic where possible; the count_words impl is the shared single
 * source (registry). No server-only need — but kept in the domain for cohesion.
 */

import { countWords } from './tool-builder/tools/count-words'
import type { ShadowRunAgent, ShadowToolGate } from './shadow'

/** A controlled input the fixture script understands. */
export interface FixtureInput {
  /** The text count_words will be run on. */
  text: string
  /** When true, the script also attempts a (fictional) mutating tool — for gate tests. */
  mutatingProbe?: boolean
  /** A named mutating tool to probe (must be `mutates:true` in the registry to prove the block). */
  mutatingToolName?: string
}

/**
 * Build a deterministic ShadowRunAgent. Given a FixtureInput it "reasons" (no
 * LLM) that the task is to count words, calls count_words THROUGH the gate
 * (read-only → allowed → executes for real), and — if the input asks — also
 * attempts a mutating tool THROUGH the gate (mutating → blocked → WOULD_MUTATE,
 * never executed). Latency/cost are fixed constants (deterministic, and honestly
 * zero cost — no provider was billed).
 */
export function makeFixtureShadowAgent(): ShadowRunAgent {
  return async (rawInput: unknown, gate: ShadowToolGate) => {
    const input = (rawInput ?? {}) as FixtureInput
    const toolAttempts: { name: string; wouldMutate: boolean; executed: boolean }[] = []
    let output: unknown = null
    let ok = true
    let error: string | null = null

    // 1) The read-only certified tool: count_words. Gate → allowed → run for real.
    const cwGate = gate.check('count_words')
    if (cwGate.allow) {
      output = countWords(typeof input.text === 'string' ? input.text : '')
      toolAttempts.push({ name: 'count_words', wouldMutate: false, executed: true })
    } else {
      // Fail-closed: a certified read-only tool being blocked is itself a failure.
      ok = false
      error = 'count_words unexpectedly blocked by the shadow gate'
      toolAttempts.push({ name: 'count_words', wouldMutate: cwGate.wouldMutate, executed: false })
    }

    // 2) Optional mutating probe: prove the gate blocks a mutating tool.
    if (input.mutatingProbe) {
      const name = input.mutatingToolName ?? '__mutating_probe__'
      const g = gate.check(name)
      // The gate must NOT allow it; the run records the attempt, never executes.
      toolAttempts.push({ name, wouldMutate: g.wouldMutate, executed: false })
    }

    return {
      ok,
      output,
      error,
      latencyMs: 5, // fixed — deterministic, no real provider timing
      costUsd: 0, // honestly zero: no billed provider call happened
      toolAttempts,
    }
  }
}
