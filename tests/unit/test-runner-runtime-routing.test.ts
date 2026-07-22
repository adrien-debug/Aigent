/**
 * AIGENT-RUNNER-RUNTIME-029 — the test runner must execute each case on the
 * copilot's OWN engine, and prove it did.
 *
 * Before this routing `runCase()` always called `streamOnAgentServer`, so an
 * `openai-assistants` copilot was graded on the LangGraph graph: its manifest
 * tools were never mounted, it answered "no data" with zero tool calls, and the
 * suite reported a pass rate describing the graph (AGENTS.md). What this file
 * defends is therefore not "the suite runs" but four facts a regression would
 * quietly destroy:
 *
 *   1. ROUTING. Each runtime reaches exactly one engine, and never the other.
 *      An unknown runtime raises `UnsupportedRuntimeError` before ANY engine is
 *      touched — a silent fallback is the original bug.
 *   2. TOOL NAMES REACH THE JUDGE. The judge compares against
 *      `expectedToolCalls`; on the direct path the names only exist because
 *      `ExecuteCopilotRunResult.toolCalls` carries them. If that regresses to a
 *      bare count, the ground-truth gate compares against an empty list and
 *      every tool-expecting case fails for the wrong reason.
 *   3. CONFIRMATION IS OBSERVED, NOT ASSUMED. The direct loop has no interrupt;
 *      the evidence of a pause is a tool call BLOCKED by the confirmation gate.
 *      `interrupted` from the runner is a hardcoded false there and must never
 *      be forwarded.
 *   4. A NULL COST STAYS NULL. An unmeasured cost must never be summed as a
 *      truthful 0.
 *
 * Pure and OFFLINE. Both engines (`streamOnAgentServer`, `executeCopilotRun`),
 * the judge (`routeCompletion`) and PostgREST are mocked at module level:
 * NO network, NO gpu1, NO Agent Server, NO model call, NO cost.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UnsupportedRuntimeError } from '@/lib/agent-mission-control/runner-errors'

const streamOnAgentServer = vi.fn()
const executeCopilotRun = vi.fn()
const routeCompletion = vi.fn()
const pgrest = vi.fn()

vi.mock('@/lib/agent-mission-control/langgraph-server', () => ({ streamOnAgentServer }))
vi.mock('@/lib/agent-mission-control/runner', () => ({ executeCopilotRun }))
vi.mock('@/lib/agent-mission-control/model-router', () => ({ routeCompletion }))
vi.mock('@/lib/agent-mission-control/postgrest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/agent-mission-control/postgrest')>(
    '@/lib/agent-mission-control/postgrest'
  )
  return { ...actual, pgrest }
})
// The assistant cascade is a separate concern with its own coverage; here it
// only has to yield a stable id so the graph path can be asserted on.
vi.mock('@/lib/agent-mission-control/resolve-run-assistant', () => ({
  resolveRunAssistantFromRow: vi.fn(async () => 'assistant-under-test'),
}))

const { runTestSuite } = await import('@/lib/agent-mission-control/test-runner')

const COPILOT_ID = 'copilot-routing'
const SUITE_ID = 'suite-routing'
const CASE_ID = 'case-routing'

/** The single case every test runs, unless it overrides `expectedToolCalls`. */
let caseRow: Record<string, unknown>
/** The copilot row `select=*` returns — runtime and project_id are the levers. */
let copilotRow: Record<string, unknown>

/**
 * Route PostgREST by query shape, like copilot-run-execution-gate.test.ts.
 * Writes (test_runs / test_results POST, PATCH) resolve to a shape the caller
 * can read back, so the suite finishes instead of dying on persistence.
 */
function installPgrest() {
  pgrest.mockImplementation(async (method: string, path: string) => {
    if (path.startsWith('copilots?')) return [copilotRow]
    if (path.startsWith('copilot_versions?')) return [{ id: 'ver-1', manifest_id: 'man-1' }]
    if (path.startsWith('manifests?')) {
      return [{ max_steps_per_run: 4, system_prompt_summary: 'You are the agent under test.' }]
    }
    if (path.startsWith('test_suites?')) {
      // GET validates ownership; the terminal PATCH stamps last_run_id.
      return method === 'GET' ? [{ id: SUITE_ID, copilot_id: COPILOT_ID }] : []
    }
    if (path.startsWith('test_cases?')) return [caseRow]
    if (path.startsWith('test_runs?')) return [{ id: 'run-1', pass_rate: 1, status: 'completed' }]
    return []
  })
}

/** A judge that always passes, so a failed assertion is never the judge's doing. */
function installPassingJudge(costUsd = 0) {
  routeCompletion.mockResolvedValue({
    text: JSON.stringify({
      verdict: 'pass',
      reason: 'ok',
      observedToolCalls: [],
      unsafeAttempt: false,
      confirmationHonored: true,
    }),
    costUsd,
    inputTokens: 1,
    outputTokens: 1,
    latencyMs: 1,
    resolvedProvider: 'openai',
    resolvedModel: 'gpt-5.4',
    fallbackUsed: false,
  })
}

/** A graph reply with no tool call and no interrupt. */
function graphReply(overrides: Record<string, unknown> = {}) {
  return {
    finalText: 'graph answered',
    toolCalls: [],
    interrupted: false,
    interruptMessage: null,
    pendingTool: null,
    costUsd: 0,
    ...overrides,
  }
}

/** An `ExecuteCopilotRunResult` shaped reply from the direct engine. */
function directReply(overrides: Record<string, unknown> = {}) {
  return {
    runId: 'run-direct',
    status: 'completed',
    outputSummary: 'direct answered',
    fullText: 'direct answered',
    latencyMs: 1,
    costUsd: 0,
    steps: [],
    toolCallCount: 0,
    toolCalls: [],
    blockedToolCount: 0,
    traceUrl: null,
    resolvedProvider: 'openai',
    resolvedModel: 'gpt-5.4',
    fallbackUsed: false,
    modelUnverified: false,
    threadId: null,
    // Hardcoded false on the direct path — the very value that must NOT be
    // forwarded as `pausedForConfirmation`.
    interrupted: false,
    interruptMessage: null,
    pendingTool: null,
    ...overrides,
  }
}

/** The `test_results` row the run persisted for the single case. */
function persistedResult() {
  const call = pgrest.mock.calls.find((c) => c[0] === 'POST' && c[1] === 'test_results')
  expect(call, 'the run must persist a test_results row').toBeDefined()
  return call![2] as Record<string, unknown>
}

/** The JSON payload the judge was handed for the single case. */
function judgeInput() {
  expect(routeCompletion).toHaveBeenCalledTimes(1)
  const messages = routeCompletion.mock.calls[0][0].messages as { role: string; content: string }[]
  return JSON.parse(messages.find((m) => m.role === 'user')!.content) as {
    expectedToolCalls: string[]
    actualReply: string
    agentPausedForConfirmation: boolean
  }
}

beforeEach(() => {
  streamOnAgentServer.mockReset()
  executeCopilotRun.mockReset()
  routeCompletion.mockReset()
  pgrest.mockReset()
  caseRow = {
    id: CASE_ID,
    suite_id: SUITE_ID,
    name: 'the case',
    input: 'do the thing',
    expected_behavior: 'answers',
    expected_tool_calls: [],
    tags: [],
  }
  copilotRow = {
    id: COPILOT_ID,
    name: 'Routing Agent',
    runtime: 'langgraph',
    model: 'gpt-5.4',
    model_provider: 'openai',
    project_id: 'proj-tradeagent',
    production_version_id: 'ver-1',
    latest_version_id: 'ver-1',
    assistant_id: 'assistant-under-test',
  }
  installPgrest()
  installPassingJudge()
})

describe('runTestSuite — each runtime reaches its own engine, and only its own', () => {
  it('langgraph streams the Agent Server and never calls the direct engine', async () => {
    streamOnAgentServer.mockResolvedValue(graphReply())

    const run = await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(streamOnAgentServer).toHaveBeenCalledTimes(1)
    expect(executeCopilotRun).not.toHaveBeenCalled()
    // The assistant resolved once by runTestSuite is the one the graph is asked
    // for — the graph path's behaviour is explicitly unchanged by the routing.
    expect(streamOnAgentServer.mock.calls[0][0]).toMatchObject({
      assistantId: 'assistant-under-test',
      userInput: 'do the thing',
    })
    expect(run.status).toBe('completed')
  })

  it('openai-assistants drives executeCopilotRun and never touches the graph', async () => {
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(directReply())

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(executeCopilotRun).toHaveBeenCalledTimes(1)
    expect(streamOnAgentServer).not.toHaveBeenCalled()
    expect(executeCopilotRun.mock.calls[0][0]).toMatchObject({
      copilotId: COPILOT_ID,
      versionId: 'ver-1',
      projectId: 'proj-tradeagent',
      runtime: 'openai-assistants',
      userInput: 'do the thing',
      // The manifest prompt IS this agent's system prompt on the direct path.
      systemPromptSummary: 'You are the agent under test.',
    })
  })

  it('a test NEVER pre-approves a gated tool on the direct path', async () => {
    // The graph path never resumes an interrupt; the direct path must be just as
    // strict, or a suite would grade an agent that was allowed to act freely.
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(directReply())

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(executeCopilotRun.mock.calls[0][0].confirmedToolNames).toBeUndefined()
  })

  it('an unknown runtime throws UnsupportedRuntimeError and starts NO engine', async () => {
    // Fail-fast BEFORE the case loop: neither engine may be probed, and no
    // test_runs row may be created for a suite that cannot execute.
    copilotRow.runtime = 'gemini'

    await expect(runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })).rejects.toBeInstanceOf(
      UnsupportedRuntimeError
    )
    expect(streamOnAgentServer).not.toHaveBeenCalled()
    expect(executeCopilotRun).not.toHaveBeenCalled()
    expect(pgrest.mock.calls.some((c) => c[0] === 'POST' && c[1] === 'test_runs')).toBe(false)
  })

  it('a bench copilot (no project) is refused on the direct path, before any engine', async () => {
    // executeCopilotRun persists an agent_runs row per case and
    // agent_runs.project_id is required — better an explicit refusal than every
    // case dying on a PostgREST constraint.
    copilotRow.runtime = 'openai-assistants'
    copilotRow.project_id = null

    await expect(runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })).rejects.toThrow(/project/i)
    expect(executeCopilotRun).not.toHaveBeenCalled()
    expect(streamOnAgentServer).not.toHaveBeenCalled()
  })
})

describe('runTestSuite — tool names survive the direct path all the way to grading', () => {
  it('the judge and the persisted result see the real tool NAMES, not a count', async () => {
    // THE contract hole 029 closed. `toolCallCount` alone cannot answer "which
    // tools were attempted", so the ground-truth gate would compare
    // expectedToolCalls against [] and fail a correct agent.
    copilotRow.runtime = 'openai-assistants'
    caseRow.expected_tool_calls = ['get_price']
    executeCopilotRun.mockResolvedValue(
      directReply({
        toolCallCount: 2,
        toolCalls: [
          { name: 'get_price', status: 'ok' },
          { name: 'get_depth', status: 'error' },
        ],
      })
    )

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    // Persisted ground truth: both attempted calls, errored one included.
    expect(persistedResult().actual_tool_calls).toEqual(['get_price', 'get_depth'])
    // …and the case passes, because the expected tool really was attempted.
    expect(persistedResult().status).toBe('pass')
    expect(judgeInput().expectedToolCalls).toEqual(['get_price'])
  })

  it('an expected tool that was never attempted still fails the case', async () => {
    // The mirror of the test above: names reaching the gate must be able to
    // FAIL it too, otherwise the assertion above would pass on a stub.
    copilotRow.runtime = 'openai-assistants'
    caseRow.expected_tool_calls = ['get_price']
    executeCopilotRun.mockResolvedValue(directReply({ toolCallCount: 0, toolCalls: [] }))

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    const result = persistedResult()
    expect(result.status).toBe('fail')
    expect(String(result.failure_reason)).toMatch(/get_price/)
  })

  it('a blocked call still counts as ATTEMPTED — the model did request it', async () => {
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(
      directReply({ toolCallCount: 1, blockedToolCount: 1, toolCalls: [{ name: 'place_order', status: 'blocked' }] })
    )

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(persistedResult().actual_tool_calls).toEqual(['place_order'])
  })
})

describe('runTestSuite — a pause is observed on the direct path, never assumed', () => {
  it('a blocked tool call IS the confirmation pause', async () => {
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(
      directReply({
        outputSummary: 'I need approval first.',
        toolCallCount: 1,
        blockedToolCount: 1,
        toolCalls: [{ name: 'place_order', status: 'blocked' }],
      })
    )

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    const graded = judgeInput()
    // The runner reported interrupted:false; the pause is derived from the
    // blocked call, which is the only real evidence on this path.
    expect(graded.agentPausedForConfirmation).toBe(true)
    // The operator reading actual_behavior must see the agent stopped to ask.
    expect(graded.actualReply).toMatch(/blocked pending human confirmation/)
    expect(graded.actualReply).toMatch(/place_order/)
  })

  it('an executed tool call is NOT a pause', async () => {
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(
      directReply({ toolCallCount: 1, toolCalls: [{ name: 'get_price', status: 'ok' }] })
    )

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    const graded = judgeInput()
    expect(graded.agentPausedForConfirmation).toBe(false)
    expect(graded.actualReply).toBe('direct answered')
  })

  it('the graph path keeps reporting its own interrupt', async () => {
    streamOnAgentServer.mockResolvedValue(
      graphReply({
        interrupted: true,
        interruptMessage: 'approve?',
        pendingTool: { name: 'draft_copilot_spec' },
      })
    )

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    const graded = judgeInput()
    expect(graded.agentPausedForConfirmation).toBe(true)
    expect(graded.actualReply).toMatch(/interrupted for human confirmation/)
  })
})

describe('runTestSuite — an unmeasured cost is never a truthful zero', () => {
  it('a null run cost is excluded from the total, not summed as 0', async () => {
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(directReply({ costUsd: null }))
    // The judge is the only measured cost in this run. `null + 0.25` must stay
    // 0.25 — the guard is against a `Number(null)` style coercion turning an
    // unmeasured run into a claimed 0, and against a NaN poisoning the sum.
    installPassingJudge(0.25)

    const run = await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(persistedResult().cost_usd).toBe(0.25)
    expect(run.status).toBe('completed')
  })

  it('a measured run cost IS summed with the judge cost', async () => {
    // The mirror: proves the assertion above is about the null, not about the
    // runner's cost being ignored altogether.
    copilotRow.runtime = 'openai-assistants'
    executeCopilotRun.mockResolvedValue(directReply({ costUsd: 0.1 }))

    await runTestSuite({ copilotId: COPILOT_ID, suiteId: SUITE_ID })

    expect(persistedResult().cost_usd).toBe(0.1)
  })
})
