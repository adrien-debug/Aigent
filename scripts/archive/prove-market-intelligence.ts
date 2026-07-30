/**
 * One real run of copilot-market-intelligence — validates tools mount (tool_call_count > 0).
 * 💲 OpenAI billed. Run only on explicit request.
 */
import { executeCopilotRun } from '../../src/lib/agent-mission-control/runner'
import { pgrest } from '../../src/lib/agent-mission-control/postgrest'

const COPILOT = 'copilot-market-intelligence'

async function main() {
  const [cop] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(COPILOT)}&select=id,latest_version_id,model,model_provider,project_id,assistant_id`
  )
  if (!cop) throw new Error(`${COPILOT} not found`)

  const versionId = cop.latest_version_id as string
  const [ver] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
  )
  const manifestId = ver?.manifest_id as string
  const [man] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `manifests?id=eq.${encodeURIComponent(manifestId)}&select=system_prompt_summary`
  )

  console.log(`assistant=${cop.assistant_id ?? 'none'} version=${versionId}`)

  const res = await executeCopilotRun({
    copilotId: COPILOT,
    versionId,
    projectId: (cop.project_id as string) ?? 'proj-tradeagent',
    model: (cop.model as string) ?? 'gpt-5.4',
    modelProvider: ((cop.model_provider as string) ?? 'openai') as 'openai',
    systemPromptSummary: (man?.system_prompt_summary as string) ?? '',
    userInput:
      'Analyze BTCUSDT market structure and volatility. Use your market tools. State provider and freshness.',
    maxSteps: 8,
    runtime: 'langgraph',
  })

  console.log(
    JSON.stringify(
      {
        status: res.status,
        toolCallCount: res.toolCallCount,
        resolvedModel: res.resolvedModel,
        modelUnverified: res.modelUnverified,
        latencyMs: res.latencyMs,
        costUsd: res.costUsd,
        outputPreview: res.outputSummary?.slice(0, 600),
      },
      null,
      2
    )
  )

  if (res.status !== 'completed' || res.toolCallCount < 1) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
