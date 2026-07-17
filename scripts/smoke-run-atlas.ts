/**
 * AIG-TRADE-001 — one real run of Atlas to validate the chain + measure cost.
 * 💲 This makes a real OpenAI call. Single run, bounded.
 */
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { executeCopilotRun } from '../src/lib/agent-mission-control/runner'

async function main() {
  const rows = await pgrest<
    Array<{ id: string; latest_version_id: string; model: string; system_prompt_summary: string }>
  >(
    'GET',
    'copilots?select=id,latest_version_id,model,manifests(system_prompt_summary)&slug=eq.atlas-market-structure',
  )
  if (!rows.length) throw new Error('atlas copilot not found')
  const c = rows[0] as unknown as {
    id: string
    latest_version_id: string
    model: string
    manifests: Array<{ system_prompt_summary: string }>
  }
  const systemPromptSummary = c.manifests?.[0]?.system_prompt_summary ?? 'Atlas — market structure.'

  const res = await executeCopilotRun({
    copilotId: c.id,
    versionId: c.latest_version_id,
    projectId: 'proj-tradeagent',
    model: c.model,
    modelProvider: 'openai',
    systemPromptSummary,
    userInput:
      'Analyze ETHUSDT market structure on the 1h and 4h timeframes and produce your TechnicalAnalysisReport. Use your market tools. If data is unavailable, say so and abstain rather than inventing.',
    maxSteps: 8,
    runtime: 'openai-assistants',
  })

  console.log(
    JSON.stringify(
      {
        status: res.status,
        costUsd: res.costUsd,
        latencyMs: res.latencyMs,
        toolCallCount: res.toolCallCount,
        blockedToolCount: res.blockedToolCount,
        resolvedModel: res.resolvedModel,
        fallbackUsed: res.fallbackUsed,
        outputSummary: res.outputSummary?.slice(0, 1200),
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error('smoke-run-atlas failed:', e)
  process.exit(1)
})
