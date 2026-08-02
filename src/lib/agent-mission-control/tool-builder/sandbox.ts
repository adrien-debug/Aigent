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
import { Worker } from 'node:worker_threads'

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
  executorId?: 'count_words'
  executeSource?: string
  execute?: (input: I, context: ToolSandboxContext) => O | Promise<O>
  cases: ReadonlyArray<ToolTestCase<I, O>>
}

export interface ToolSandboxRunResult {
  status: ToolSandboxStatus
  evidence: ToolTestEvidence
  reason: string | null
}

const ALLOWED_CAPABILITIES = new Set<ToolSandboxCapability>(['local-deterministic-exec'])

const WORKER_BOOTSTRAP = `
const { parentPort, workerData } = require('node:worker_threads')
const vm = require('node:vm')

function countWords(text) {
  const normalized = String(text ?? '')
  const words = normalized.trim() === '' ? [] : normalized.trim().split(/\\s+/u)
  const longestWord = words.reduce((max, w) => Math.max(max, w.length), 0)
  return { ok: true, words: words.length, characters: normalized.length, longestWord }
}

function serializeError(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

function runExecutor(input, executorId, executeSource, timeoutMs) {
  const contextArg = Object.freeze({ env: Object.freeze({}) })
  if (executorId === 'count_words') return countWords(input)
  if (typeof executeSource !== 'string' || executeSource.trim() === '') {
    throw new Error('sandbox executor is missing')
  }

  const sandboxGlobal = Object.create(null)
  sandboxGlobal.JSON = JSON
  sandboxGlobal.Math = Math
  sandboxGlobal.String = String
  sandboxGlobal.Number = Number
  sandboxGlobal.Boolean = Boolean
  sandboxGlobal.Array = Array
  sandboxGlobal.Object = Object
  sandboxGlobal.RegExp = RegExp
  sandboxGlobal.Date = Date
  sandboxGlobal.process = undefined
  sandboxGlobal.global = undefined
  sandboxGlobal.require = undefined
  sandboxGlobal.module = undefined
  sandboxGlobal.Buffer = undefined
  sandboxGlobal.setTimeout = undefined
  sandboxGlobal.setInterval = undefined
  sandboxGlobal.setImmediate = undefined
  sandboxGlobal.clearTimeout = undefined
  sandboxGlobal.clearInterval = undefined
  sandboxGlobal.clearImmediate = undefined

  const context = vm.createContext(sandboxGlobal)
  const script = new vm.Script(
    '(function(){ const __fn = (' + executeSource + '); return __fn(__input, __ctx); })()',
    { filename: 'tool-builder-sandbox-executor.vm' },
  )
  context.__input = input
  context.__ctx = contextArg
  return script.runInContext(context, { timeout: timeoutMs })
}

Promise.resolve()
  .then(() => runExecutor(workerData.input, workerData.executorId, workerData.executeSource, workerData.timeoutMs))
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((error) => parentPort.postMessage({ ok: false, error: serializeError(error) }))
`

/** Structural equality good enough for JSON-serialisable tool outputs. */
function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function byteSize(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

function runWorkerCase(input: unknown, sandbox: LocalDeterministicSandbox<unknown, unknown>): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(WORKER_BOOTSTRAP, {
      eval: true,
      workerData: {
        input,
        timeoutMs: sandbox.timeoutMs,
        executorId: sandbox.executorId ?? null,
        executeSource: sandbox.executeSource ?? sandbox.execute?.toString() ?? null,
      },
    })
    let settled = false

    const timer = setTimeout(async () => {
      if (settled) return
      settled = true
      try {
        await worker.terminate()
      } catch {
        // Ignore termination errors: timeout semantics already fail the case.
      }
      reject(new Error(`sandbox timeout after ${sandbox.timeoutMs}ms`))
    }, sandbox.timeoutMs)

    worker.on('message', async (payload: { ok: boolean; result?: unknown; error?: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        await worker.terminate()
      } catch {
        // Worker may already be closed after posting the message.
      }
      if (payload.ok) {
        resolve(payload.result)
        return
      }
      reject(new Error(payload.error ?? 'sandbox worker execution failed'))
    })

    worker.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })

    worker.on('exit', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        reject(new Error('sandbox worker exited without result'))
        return
      }
      reject(new Error(`sandbox worker exited with code ${code}`))
    })
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
  if (!sandbox.executorId && !sandbox.executeSource && !sandbox.execute) {
    return {
      status: 'unavailable',
      evidence: { ran: false, passed: 0, failed: 0, detail: 'sandbox executor missing' },
      reason: 'sandbox executor is missing',
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

      const got = (await runWorkerCase(c.input, sandbox as LocalDeterministicSandbox<unknown, unknown>)) as O
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
