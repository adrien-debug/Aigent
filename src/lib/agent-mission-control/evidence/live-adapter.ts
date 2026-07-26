/**
 * AIGENT-DETERMINISTIC-EVIDENCE-001 — the LIVE execution adapter (server only).
 *
 * The default adapter both runners use. It is a faithful, behaviour-preserving
 * extraction of the agent leg + judge leg that previously lived INLINE in
 * test-runner.ts (`executeCaseOnRuntime`) and benchmark-runner.ts
 * (`runTaskOnGraph` / `runTaskOnDirectEngine`). Nothing about a real run changes:
 * the same engines are called with the same arguments, the same reply annotation
 * is produced, and the same judge completion is issued. The routing tests
 * (test-runner-runtime-routing, benchmark-runner-runtime-routing) mock these very
 * modules at the boundary, so they keep passing unchanged — the calls simply
 * originate here now instead of in the runner body.
 *
 * The only reason this code moved out of the runners is to expose a seam a
 * deterministic fixture can occupy for a $0 offline proof. On the live path this
 * IS the runner's old behaviour, verbatim.
 */
import 'server-only'

import { JUDGE_TEMPERATURE } from '../judge-calibration'
import { runOnAgentServer, streamOnAgentServer } from '../langgraph-server'
import { routeCompletion } from '../model-router'
import { executeCopilotRun } from '../runner'
import { UnsupportedRuntimeError } from '../runner-errors'
import {
  EVIDENCE_MODE_DB_LABEL,
  type AgentLegRequest,
  type AgentLegResult,
  type EvidenceExecutionAdapter,
  type JudgeLegRequest,
  type JudgeLegResult,
} from './execution-adapter'

/** Run the agent leg on the copilot's OWN runtime — the three-way routing verbatim. */
async function executeAgent(request: AgentLegRequest): Promise<AgentLegResult> {
  if (request.runtime === 'langgraph') {
    // stream=true → streamOnAgentServer (live canvas), else the blocking
    // runOnAgentServer. The graded result is reconstructed identically either
    // way; only the observability differs. This mirrors the pre-existing split:
    // the test runner streamed, the benchmark runner did not.
    const gr = request.stream
      ? await streamOnAgentServer({
          userInput: request.input,
          assistantId: request.assistantId,
          maxSteps: request.maxSteps,
          onNode: request.onNode,
          onThread: request.onThread,
        })
      : await runOnAgentServer({
          userInput: request.input,
          assistantId: request.assistantId,
          maxSteps: request.maxSteps,
        })
    return {
      toolCalls: gr.toolCalls.map((t) => ({ toolName: t.toolName, status: t.status })),
      reply: gr.interrupted
        ? `[interrupted for human confirmation] ${gr.interruptMessage ?? ''}${gr.pendingTool ? ` (pending tool: ${gr.pendingTool.name})` : ''}`.trim()
        : gr.finalText,
      pausedForConfirmation: gr.interrupted,
      pendingToolName: gr.pendingTool?.name ?? null,
      costUsd: gr.costUsd,
    }
  }

  if (request.runtime === 'openai-assistants') {
    const res = await executeCopilotRun({
      copilotId: request.copilotId,
      // Test/benchmark harnesses run DRAFT candidates on purpose → skip the
      // "version still serving" lifecycle guard (AIGENT-RUNTIME-PROMOTION-001).
      allowNonActiveVersion: true,
      versionId: request.versionId,
      projectId: request.projectId,
      model: request.model,
      modelProvider: request.modelProvider,
      systemPromptSummary: request.systemPromptSummary,
      userInput: request.input,
      maxSteps: request.maxSteps,
      // Deliberately NO confirmedToolNames: a test/benchmark never auto-approves,
      // exactly as the graph path never resumes an interrupt.
      runtime: request.runtime,
      userLabel: request.userLabel,
    })
    // The direct loop has no Agent Server interrupt; its equivalent of "the agent
    // stopped and asked" is the confirmation gate blocking a tool. The evidence is
    // the blocked call, never an invented pause — `res.interrupted` is a hardcoded
    // false here and is deliberately NOT forwarded.
    const blocked = res.toolCalls.filter((t) => t.status === 'blocked')
    const pausedForConfirmation = blocked.length > 0
    const pendingToolName = blocked[0]?.name ?? null
    return {
      toolCalls: res.toolCalls.map((t) => ({ toolName: t.name, status: t.status })),
      reply: pausedForConfirmation
        ? `[blocked pending human confirmation] ${res.outputSummary}${pendingToolName ? ` (pending tool: ${pendingToolName})` : ''}`.trim()
        : res.fullText ?? res.outputSummary,
      pausedForConfirmation,
      pendingToolName,
      costUsd: res.costUsd,
    }
  }

  throw new UnsupportedRuntimeError(
    `no execution engine for runtime '${request.runtime}' — the live adapter serves ` +
      `'langgraph' (Agent Server) and 'openai-assistants' (direct model-router loop) only`
  )
}

/** The judge leg — a strict-JSON grader completion through the model router. */
async function judge(request: JudgeLegRequest): Promise<JudgeLegResult> {
  const judgeRes = await routeCompletion({
    purpose: 'judge',
    modelProvider: request.modelProvider,
    model: request.model,
    messages: [
      { role: 'system', content: request.systemPrompt },
      { role: 'user', content: JSON.stringify(request.payload) },
    ],
    responseFormat: 'json',
    maxOutputTokens: 512,
    // A verdict is a MEASUREMENT, so it must not be sampled: at the provider
    // default, the same reply passed in one run and failed in the next, which
    // reported an improvement as a regression (judge-calibration.ts). This binds
    // the JUDGE leg only — the agent leg above keeps its own runtime's sampling.
    temperature: JUDGE_TEMPERATURE,
  })
  return { text: judgeRes.text, costUsd: judgeRes.costUsd }
}

/**
 * The live adapter singleton — the default both runners fall back to when no
 * adapter is injected, so an ordinary user run behaves exactly as before.
 */
export const liveEvidenceAdapter: EvidenceExecutionAdapter = {
  mode: 'live',
  label: EVIDENCE_MODE_DB_LABEL.live,
  executeAgent,
  judge,
}
