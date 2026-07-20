/**
 * AIG-AGENT-QUALITY-005 — Lot B: one REAL agent run proving executed-model
 * verification is persisted. Atlas (openai-assistants runtime → direct path)
 * runs through the fixed runner; the new agent_runs row must carry
 * resolved_model = the provider's dated snapshot and model_unverified = false.
 * Writes one additive run row to the live DB. No retry, no fallback.
 */
import { executeCopilotRun } from '@/lib/agent-mission-control/runner'

const result = await executeCopilotRun({
  copilotId: 'copilot-atlas-market-structure-6836ef1e',
  versionId: 'version-atlas-market-structure-v2-6778e3bb',
  projectId: 'proj-tradeagent',
  model: 'gpt-5.4',
  modelProvider: 'openai',
  systemPromptSummary: 'You are Atlas, a market-structure analyst. Answer in one short sentence.',
  userInput: 'In one sentence: what is a support level in technical analysis?',
  maxSteps: 2,
  allowFallback: false,
})

console.log(
  'RUN ' +
    JSON.stringify({
      runId: result.runId,
      status: result.status,
      resolvedProvider: result.resolvedProvider,
      resolvedModel: result.resolvedModel,
      modelUnverified: result.modelUnverified,
      costUsd: result.costUsd,
      latencyMs: result.latencyMs,
      outputPreview: (result.outputSummary || '').slice(0, 80),
    }),
)
