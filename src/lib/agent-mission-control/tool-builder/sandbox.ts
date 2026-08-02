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

export type ToolSandboxCapability = 'local-deterministic-exec' | string

export type ToolSandboxStatus = 'certified' | 'failed' | 'unavailable'

export interface ToolSandboxContext {
  /** Intentionally empty env bag to prevent implicit secret reads. */
  env: Readonly<Record<string, never>>
}

export interface LocalDeterministicSandbox<I, O> {
  id: string
  timeoutMs: number
  maxCases: number
  maxInputBytes: number
  maxOutputBytes: number
  capabilities: ReadonlyArray<ToolSandboxCapability>
  execute: (input: I, context: ToolSandboxContext) => O | Promise<O>
  cases: ReadonlyArray<ToolTestCase<I, O>>
}

export interface ToolSandboxRunResult {
  status: ToolSandboxStatus
  evidence: ToolTestEvidence
  reason: string | null
}

const ALLOWED_CAPABILITIES = new Set<ToolSandboxCapability>(['local-deterministic-exec'])
const EMPTY_CONTEXT: ToolSandboxContext = Object.freeze({ env: Object.freeze({}) })

/** Structural equality good enough for JSON-serialisable tool outputs. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`sandbox timeout after ${timeoutMs}ms`)), timeoutMs)
    promise
      .then((value) => resolve(value))
      .catch((err) => reject(err))
      .finally(() => clearTimeout(timer))
  })
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

/**
 * Execute one local deterministic sandbox with strict fail-closed guards:
 * - explicit capability allowlist,
 * - timeout per invocation,
 * - bounded input/output sizes,
 * - isolated context (no env injection),
 * - no success if sandbox is unavailable.
 */
export async function runLocalDeterministicSandbox<I, O>(
  sandbox: LocalDeterministicSandbox<I, O>,
): Promise<ToolSandboxRunResult> {
  if (sandbox.cases.length === 0) {
    return {
      status: 'failed',
      evidence: { ran: false, passed: 0, failed: 0, detail: 'no test cases — nothing to prove' },
      reason: 'sandbox has no cases',
    }
  }
  if (sandbox.cases.length > sandbox.maxCases) {
    return {
      status: 'failed',
      evidence: {
        ran: false,
        passed: 0,
        failed: sandbox.cases.length,
        detail: `too many cases: ${sandbox.cases.length} > ${sandbox.maxCases}`,
      },
      reason: 'sandbox case limit exceeded',
    }
  }
  if (sandbox.capabilities.some((cap) => !ALLOWED_CAPABILITIES.has(cap))) {
    return {
      status: 'unavailable',
      evidence: { ran: false, passed: 0, failed: 0, detail: 'sandbox capability not allowlisted' },
      reason: 'sandbox capabilities are not allowlisted',
    }
  }

  let passed = 0
  let failed = 0
  const failures: string[] = []

  for (const c of sandbox.cases) {
    try {
      const inputSize = byteSize(c.input)
      if (inputSize > sandbox.maxInputBytes) {
        failed++
        failures.push(`${c.name}: input too large (${inputSize} > ${sandbox.maxInputBytes} bytes)`)
        continue
      }

      const got = await withTimeout(Promise.resolve(sandbox.execute(c.input, EMPTY_CONTEXT)), sandbox.timeoutMs)
      const outputSize = byteSize(got)
      if (outputSize > sandbox.maxOutputBytes) {
        failed++
        failures.push(`${c.name}: output too large (${outputSize} > ${sandbox.maxOutputBytes} bytes)`)
        continue
      }

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
    status: failed === 0 && passed > 0 ? 'certified' : 'failed',
    evidence: {
      ran: true,
      passed,
      failed,
      detail: failed === 0 ? `${passed}/${sandbox.cases.length} passed` : failures.join(' | '),
    },
    reason: failed === 0 && passed > 0 ? null : 'sandbox evidence contains failures',
  }
}
