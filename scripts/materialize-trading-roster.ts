/**
 * AIG-TRADE-001 — materialize the 6 trading agents from the roster.
 *
 * Maps each roster TradingAgentDef → CreateCopilotInput and calls
 * createCopilotFromManifest (a pure PostgREST multi-insert — NO OpenAI call).
 * Idempotent: skips a roster agent whose slug is already materialized.
 *
 * Run: node --env-file=.env.local npx tsx --conditions=react-server \
 *        scripts/materialize-trading-roster.ts
 */

import { ROSTER } from '../src/lib/agent-mission-control/market/agents/roster'
import { createCopilotFromManifest } from '../src/lib/agent-mission-control/authoring-writes'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import type { CreateCopilotInput, ProposedTool } from '../src/lib/agent-mission-control/authoring-types'
import { TRADING_TOOL_DESCRIPTIONS } from '../src/lib/agent-mission-control/market/tool-descriptions'

const TARGET_PROJECT_ID = 'proj-tradeagent'
const MODEL = 'gpt-5.4'

/** Every trading tool is a read-only internal handler, low risk, no confirm. */
function proposedToolsFor(toolIds: readonly string[]): ProposedTool[] {
  return toolIds.map((name) => ({
    name,
    description:
      TRADING_TOOL_DESCRIPTIONS[name] ??
      `Read-only market tool ${name} (AIG-TRADE-001). Returns UNAVAILABLE rather than fabricating data.`,
    provider: 'internal' as const,
    riskLevel: 'low' as const,
    // Provably read-only (market/tools.ts is GET-only). Assert it explicitly:
    // authoring-writes defaults `mutates` to true (fail-closed), so omitting it
    // would materialize every read tool as write-capable and break the agent's
    // read-only classification.
    mutates: false,
    requiresConfirmation: false,
  }))
}

async function existingSlugs(): Promise<Set<string>> {
  const rows = await pgrest<Array<{ slug: string }>>(
    'GET',
    'copilots?select=slug',
  )
  return new Set(rows.map((r) => r.slug))
}

async function main() {
  const already = await existingSlugs()
  const created: Array<{ slug: string; copilotId: string }> = []
  const skipped: string[] = []

  for (const agent of ROSTER) {
    if (already.has(agent.slug)) {
      skipped.push(agent.slug)
      continue
    }
    const input: CreateCopilotInput = {
      name: agent.name,
      slug: agent.slug,
      description: agent.specialty,
      runtime: 'openai-assistants', // direct model-router loop (not the bench builder graph)
      model: MODEL,
      modelProvider: 'openai',
      owner: 'aig-trade-001',
      tags: ['trading', 'aig-trade-001', 'eth-only'],
      projectId: null, // validation bench
      targetProjectIds: [TARGET_PROJECT_ID],
      manifest: {
        systemPromptSummary: agent.systemPromptSummary,
        allowedRoutes: [...agent.allowedRoutes],
        forbiddenActions: [...agent.forbiddenActions],
        confirmationPolicy: agent.confirmationPolicy,
        alwaysConfirmActions: [...agent.alwaysConfirmActions],
        outputContract: {
          format: agent.outputContract.format,
          schemaName: agent.outputContract.schemaName,
          invariants: [...agent.outputContract.invariants],
        },
        proposedTools: proposedToolsFor(agent.toolIds),
        skills: agent.skills.map((s) => ({ label: s.label, ...(s.detail ? { detail: s.detail } : {}) })),
        maxStepsPerRun: agent.maxStepsPerRun,
        maxCostPerRunUsd: agent.maxCostPerRunUsd,
      },
    }
    const copilotId = await createCopilotFromManifest(input)
    created.push({ slug: agent.slug, copilotId })
    console.log(`materialized ${agent.slug} -> ${copilotId}`)
  }

  console.log(
    JSON.stringify(
      { created, skipped, total: ROSTER.length },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error('materialize-trading-roster failed:', e)
  process.exit(1)
})
