/**
 * AIGENT-RUNTIME-PROMOTION-001 — Phase 3, step 9 completion: a REAL run of the
 * promoted proof agent, through the official runtime.
 *
 * The main proof (prove-factory-e2e.ts) proves create→gate→promotion via the
 * product/official paths. Its post-promotion run failed for two ENVIRONMENT
 * reasons, not a chain defect: (1) createCopilotFromManifest alone does not
 * provision the LangGraph assistant (that step lives in the route, not the
 * function) → the copilot ran the bare shared graph (AGENTS.md trap); (2) the
 * runner refused the REMOTE LANGGRAPH_API_URL in dev. This script closes both,
 * the way AGENTS.md prescribes: ensureCopilotAssistant FIRST, then run with the
 * LOCAL agent server — then executes a REAL run and reports the truth.
 *
 * Run: LANGGRAPH_API_URL=http://127.0.0.1:2024 \
 *   node --env-file=.env.local "$(command -v npx)" -y tsx --conditions=react-server \
 *   scripts/prove-factory-run.ts <copilotId>
 */
import { ensureCopilotAssistant } from '../src/lib/agent-mission-control/langgraph-assistants'
import { setCopilotAssistantId } from '../src/lib/agent-mission-control/authoring-writes'
import { executeCopilotRun } from '../src/lib/agent-mission-control/runner'
import { pgrest } from '../src/lib/agent-mission-control/postgrest'

const eq = (col: string, val: string) => `${col}=eq.${encodeURIComponent(val)}`

async function main() {
  const copilotId = process.argv[2]
  if (!copilotId) throw new Error('usage: prove-factory-run.ts <copilotId>')
  console.log(`\n=== FACTORY RUN PROOF · copilot=${copilotId} · endpoint=${process.env.LANGGRAPH_API_URL} ===\n`)

  const [cop] = await pgrest<Record<string, unknown>[]>(
    'GET',
    `copilots?${eq('id', copilotId)}&select=status,runtime,production_version_id,project_id,model,model_provider,assistant_id`,
  )
  if (!cop) throw new Error(`copilot ${copilotId} not found`)
  const versionId = cop.production_version_id as string
  console.log(`copilot status=${cop.status} runtime=${cop.runtime} production=${versionId} assistant=${cop.assistant_id ?? 'none'}`)

  // 1) Provision the dedicated LangGraph assistant (the missing step — AGENTS.md:
  //    a langgraph copilot WITHOUT an assistant runs the bare graph, tool_call_count=0).
  const assistantId = await ensureCopilotAssistant({ copilotId })
  await setCopilotAssistantId(copilotId, assistantId)
  console.log(`✓ assistant provisioned + persisted: ${assistantId}`)

  // 2) A REAL run of the PROMOTED (production) version, through the official runtime.
  const result = await executeCopilotRun({
    copilotId,
    versionId,
    projectId: (cop.project_id as string | null) ?? 'unassigned',
    model: (cop.model as string) ?? 'gpt-5.4',
    modelProvider: ((cop.model_provider as string) ?? 'openai') as 'openai',
    systemPromptSummary: 'You count the words in the user text using the count_words tool and report the number.',
    userInput: 'Count the words in: the quick brown fox jumps over the lazy dog',
    maxSteps: 4,
    userLabel: 'factory-proof-run',
  })

  console.log(
    `\n${result.status === 'completed' ? '✓' : '✗'} run status=${result.status} runId=${result.runId} ` +
      `tools=${result.toolCallCount} model=${result.resolvedModel ?? 'unverified'} latency=${result.latencyMs}ms`,
  )
  console.log(`output: ${result.outputSummary}`)
  console.log(JSON.stringify({
    runId: result.runId, status: result.status, toolCallCount: result.toolCallCount,
    resolvedModel: result.resolvedModel, modelUnverified: result.modelUnverified,
    traceUrl: result.traceUrl, assistantId,
  }, null, 2))

  // 3) Confirm the run + telemetry landed.
  const [runRow] = await pgrest<Record<string, unknown>[]>('GET', `agent_runs?${eq('id', result.runId)}&select=id,status,tool_call_count,version_id`)
  const tele = await pgrest<Record<string, unknown>[]>('GET', `runtime_telemetry_events?${eq('run_id', result.runId)}&select=id,status,output_shape`)
  console.log(`\npersisted agent_runs: ${JSON.stringify(runRow)}`)
  console.log(`persisted telemetry: ${tele.length} event(s) ${tele.length ? JSON.stringify(tele[0].output_shape) : ''}`)
}

main().catch((err) => {
  console.error('\n✗ RUN PROOF FAILED:', err instanceof Error ? err.message : err)
  process.exit(1)
})
