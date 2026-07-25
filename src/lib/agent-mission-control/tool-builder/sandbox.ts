/**
 * Tool Builder sandbox — runs a candidate LOCAL tool against its declared test
 * cases and returns real evidence (AIGENT-CORE-FACTORY-035, Tool Builder).
 *
 * This is what makes certification EARNED rather than asserted: `certifyMission`
 * (mission.ts) only reaches CERTIFIED when handed evidence produced HERE, from a
 * real execution of the tool over input/expected pairs. A build whose sandbox
 * run failed or never ran cannot certify.
 *
 * Scope: LOCAL DETERMINISTIC tools only — a pure `(input) => output` function
 * and a list of `{ input, expected }` cases. No IO, no network, no secret, so
 * running it in-process is itself safe (a pure function can't reach the network
 * or the DB). Non-local kinds are refused upstream by validateToolSpec.
 */

import type { ToolTestEvidence } from './mission'

/** One deterministic test case for a local tool. */
export interface ToolTestCase<I, O> {
  name: string
  input: I
  expected: O
}

/** Structural equality good enough for JSON-serialisable tool outputs. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Execute `fn` over every case and return pass/fail evidence. Never throws — a
 * case whose function call throws counts as a FAIL (with the message in detail),
 * so a broken tool produces failed evidence rather than crashing the builder.
 */
export function runToolSandbox<I, O>(
  fn: (input: I) => O,
  cases: ReadonlyArray<ToolTestCase<I, O>>,
): ToolTestEvidence {
  if (cases.length === 0) {
    return { ran: false, passed: 0, failed: 0, detail: 'no test cases — nothing to prove' }
  }
  let passed = 0
  let failed = 0
  const failures: string[] = []
  for (const c of cases) {
    try {
      const got = fn(c.input)
      if (deepEqual(got, c.expected)) {
        passed++
      } else {
        failed++
        failures.push(`${c.name}: got ${JSON.stringify(got)}, expected ${JSON.stringify(c.expected)}`)
      }
    } catch (err) {
      failed++
      failures.push(`${c.name}: threw ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return {
    ran: true,
    passed,
    failed,
    detail: failed === 0 ? `${passed}/${cases.length} passed` : failures.join(' | '),
  }
}
