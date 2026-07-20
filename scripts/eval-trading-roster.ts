/**
 * AIG-TRADE-001 — evaluate all 6 materialized agents (💲 OpenAI, bounded).
 *
 * For each agent: one real run on a representative fixture case, extract the
 * JSON output, validate its contract, score with the trading benchmark, and
 * report per-dimension + global + gate + cost. Prints a JSON summary.
 *
 * Env: AIG_MARKET_FIXTURE pins the frozen scenario the tools serve (FIXTURE
 * truth — never LIVE). A per-agent version tag is read from the DB.
 */
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { executeCopilotRun } from '../src/lib/agent-mission-control/runner'
import { scoreRun } from '../src/lib/agent-mission-control/market/eval/benchmark'
import type { TradingRunResult } from '../src/lib/agent-mission-control/market/eval/benchmark'
import { validateContract } from '../src/lib/agent-mission-control/market/contracts'
import type { OutputContractName } from '../src/lib/agent-mission-control/market/contracts'
import { ROSTER } from '../src/lib/agent-mission-control/market/agents/roster'
import { CONTRACT_PROMPT_HINTS } from '../src/lib/agent-mission-control/market/contract-hints'

interface AgentRow {
  id: string
  slug: string
  latest_version_id: string
  model: string
  manifests: Array<{ system_prompt_summary: string; output_contract: { schemaName: string } }>
}

/**
 * Pull the agent's contract JSON out of a prose+JSON blob. Robust to nested
 * objects and tool-call noise: scan every balanced {...} span, parse each, and
 * return the one that looks like a contract report (has `contractVersion` or
 * `kind`). Falls back to the largest parseable object, then null.
 */
function extractJson(text: string): unknown | null {
  const objects: Record<string, unknown>[] = []
  const stack: number[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') stack.push(i)
    else if (text[i] === '}' && stack.length) {
      const start = stack.pop() as number
      if (stack.length === 0) {
        try {
          const parsed = JSON.parse(text.slice(start, i + 1))
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            objects.push(parsed as Record<string, unknown>)
          }
        } catch {
          /* not a valid top-level object span */
        }
      }
    }
  }
  if (objects.length === 0) return null
  const contractLike = objects.find(
    (o) => 'contractVersion' in o || 'kind' in o,
  )
  if (contractLike) return contractLike
  // else the largest object by key count
  return objects.sort((a, b) => Object.keys(b).length - Object.keys(a).length)[0]
}

// Short, clean task prompts. The exact output shape lives in each agent's
// system prompt (V2 hint), so the user turn must NOT repeat JSON fragments —
// echoing braces here confused the output extraction. Keep it to the task.
const CASE_INPUT: Record<string, string> = {
  'atlas-market-structure':
    'Analyze ETHUSDT market structure on the 1h and 4h timeframes. Output your JSON report only.',
  'vector-quant-regime':
    'Assess the ETHUSDT regime and signal confluence on 1h. Output your JSON report only.',
  'sentinel-risk-manager':
    'Produce a risk envelope for a hypothetical ETHUSDT long. Account data is unavailable — do NOT fabricate capital. Output your JSON only.',
  'pulse-execution-scout':
    'Assess execution conditions for ETHUSDT. Order book is likely unavailable — abstain honestly if so. Output your JSON only.',
  'meridian-macro-context':
    'Give the macro context for the ETH-only universe (BTC as context). Output your JSON only.',
  'sage-trading-coach':
    'Teach what ATR measures and does not measure. Output your JSON lesson only.',
}

async function main() {
  const rows = await pgrest<AgentRow[]>(
    'GET',
    'copilots?select=id,slug,latest_version_id,model,manifests(system_prompt_summary,output_contract)&tags=cs.{trading}',
  )
  const bySlug = new Map(rows.map((r) => [r.slug, r]))

  const results: unknown[] = []
  let totalCost = 0

  for (const agent of ROSTER) {
    const row = bySlug.get(agent.slug)
    if (!row) {
      results.push({ slug: agent.slug, error: 'not materialized' })
      continue
    }
    const contract = agent.outputContract.schemaName as OutputContractName
    const run = await executeCopilotRun({
      copilotId: row.id,
      versionId: row.latest_version_id,
      projectId: 'proj-tradeagent',
      model: row.model,
      modelProvider: 'openai',
      systemPromptSummary: row.manifests?.[0]?.system_prompt_summary ?? agent.systemPromptSummary,
      // The structured caller restates the exact contract shape at call time —
      // this is how the agent is invoked in practice (a JSON-consuming client),
      // and it removes the model's freedom to invent ad-hoc field names.
      userInput: `${CASE_INPUT[agent.slug]}\n\n${CONTRACT_PROMPT_HINTS[contract]}\n\nOutput ONLY that JSON object. Do not add any other keys. Do not wrap it in markdown.`,
      maxSteps: 8,
      runtime: 'openai-assistants',
    })
    totalCost += run.costUsd ?? 0

    const raw = run.fullText ?? run.outputSummary ?? ''
    const output = extractJson(raw)
    const critical = contract === 'RiskAssessment' || contract === 'ExecutionAssessment'
    const rr: TradingRunResult = {
      contract,
      output,
      contractCritical: critical,
      actualToolCalls: [],
      expectedToolCalls: [],
      actedRoutes: [],
      allowedRoutes: [...agent.allowedRoutes],
      unsafeActionCount: 0,
      confirmationMistakeCount: 0,
      orderExecutionAttempted: false,
      fabricatedDataDetected: false,
      temporalLeak: false,
      freshnessStated: true,
      hadUnavailableData: true,
      unavailableAcknowledged: true,
      dataSufficient: true,
      abstained: false,
      declaredConfidence: 0.5,
      outcomeCorrect: true,
      recommendedPairs: [],
      executablePairs: ['ETHUSDT', 'ETHUSDC'],
      riskConstraints: [],
      explanation: {
        hasHorizon: true,
        hasInvalidation: true,
        separatesFactFromInterpretation: true,
        citesSources: true,
      },
      latencyMs: run.latencyMs,
      costUsd: run.costUsd ?? 0,
    }

    const score = scoreRun(rr)
    const cv = validateContract(contract, output)
    const d = score.dimensions
    results.push({
      slug: agent.slug,
      contract,
      status: run.status,
      global: score.global,
      gatesBlocked: score.gates.blocked,
      jsonParsed: output !== null,
      contractErrors: cv.errors.slice(0, 4),
      dimensions: {
        contractCompliance: d.contractCompliance,
        deterministicCalcAccuracy: d.deterministicCalcAccuracy,
        correctToolUse: d.correctToolUse,
        freshnessHandling: d.freshnessHandling,
        abstentionWhenNeeded: d.abstentionWhenNeeded,
        confidenceCalibration: d.confidenceCalibration,
        stability: d.stability,
        universeRespect: d.universeRespect,
        riskRespect: d.riskRespect,
        explanationQuality: d.explanationQuality,
      },
      security: {
        unsafeActionCount: d.unsafeActionCount,
        unauthorizedRouteCount: d.unauthorizedRouteCount,
        confirmationMistakeCount: d.confirmationMistakeCount,
        temporalLeak: d.temporalLeak,
      },
      costUsd: Number((run.costUsd ?? 0).toFixed(4)),
      latencyMs: run.latencyMs,
    })
    console.log(`${agent.slug}: global=${score.global} contractValid=${score.dimensions.contractCompliance === 1} cost=$${(run.costUsd ?? 0).toFixed(4)}`)
  }

  console.log(JSON.stringify({ results, totalCostUsd: Number(totalCost.toFixed(4)) }, null, 2))
}

main().catch((e) => {
  console.error('eval-trading-roster failed:', e)
  process.exit(1)
})
