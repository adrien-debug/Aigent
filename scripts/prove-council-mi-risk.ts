/**
 * Council-style briefing: Market Intelligence synthesis + Portfolio Risk Guardian.
 * 💲 Two OpenAI runs. Does not call composeCouncil (needs structured contracts).
 */
import { executeCopilotRun } from '../src/lib/agent-mission-control/runner'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'

const MI = 'copilot-market-intelligence'
const RISK = 'copilot-portfolio-risk-guardian'
const PAIR = 'BTCUSDT'

async function loadRunInput(copilotId: string, versionId: string, userInput: string) {
  const [cop] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id,model,model_provider,project_id`
  )
  const [ver] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=manifest_id`
  )
  const [man] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `manifests?id=eq.${encodeURIComponent(ver.manifest_id as string)}&select=system_prompt_summary`
  )
  const res = await executeCopilotRun({
    copilotId,
    versionId,
    projectId: (cop.project_id as string) ?? 'proj-tradeagent',
    model: (cop.model as string) ?? 'gpt-5.4',
    modelProvider: ((cop.model_provider as string) ?? 'openai') as 'openai',
    systemPromptSummary: (man.system_prompt_summary as string) ?? '',
    userInput,
    maxSteps: 8,
    runtime: 'langgraph',
  })
  return res
}

async function main() {
  console.log('\n=== COUNCIL BRIEFING MI + RISK ===\n')

  const mi = await loadRunInput(
    MI,
    'ver-market-intelligence-v1',
    `Full market synthesis for ${PAIR}: direction, structure, volatility, liquidity. Use all five read tools. State provider and freshness.`
  )
  console.log(`MI: ${mi.status} tools=${mi.toolCallCount} model=${mi.resolvedModel}`)
  console.log(mi.outputSummary?.slice(0, 600))

  const risk = await loadRunInput(
    RISK,
    'ver-portfolio-risk-guardian-v1',
    `Given this market context for ${PAIR}, assess market-side risk (volatility, derivatives, liquidity). Account data likely UNAVAILABLE — say so. Alerts with severity.\n\nContext:\n${mi.outputSummary?.slice(0, 800)}`
  )
  console.log(`\nRISK: ${risk.status} tools=${risk.toolCallCount} model=${risk.resolvedModel}`)
  console.log(risk.outputSummary?.slice(0, 600))

  console.log(
    JSON.stringify(
      {
        mi: { runId: mi.runId, toolCallCount: mi.toolCallCount, tools: mi.toolCalls?.map((t) => t.name) },
        risk: { runId: risk.runId, toolCallCount: risk.toolCallCount, tools: risk.toolCalls?.map((t) => t.name) },
      },
      null,
      2
    )
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
