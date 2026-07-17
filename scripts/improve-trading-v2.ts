/**
 * AIG-TRADE-001 — V2 improvement: append the precise per-contract JSON output
 * hint to each trading agent's system prompt. Behaviour-only patch (no tool
 * change) — exactly what the improvement loop permits. 0 OpenAI (pure DB).
 *
 * Creates a new manifest (v0.2.0-draft) + copilot_version per agent and moves
 * copilots.latest_version_id to it. Idempotent: skips an agent that already
 * has a v0.2.0-draft version.
 */
import { pgrest } from '../src/lib/agent-mission-control/postgrest'
import { ROSTER } from '../src/lib/agent-mission-control/market/agents/roster'
import { CONTRACT_PROMPT_HINTS } from '../src/lib/agent-mission-control/market/contract-hints'
import { makeId } from '../src/lib/agent-mission-control/slug'

interface Copilot {
  id: string
  slug: string
  latest_version_id: string
  model: string
}
interface Manifest {
  id: string
  copilot_id: string
  system_prompt_summary: string
  allowed_routes: string[]
  forbidden_actions: string[]
  confirmation_policy: string
  always_confirm_actions: string[]
  memory_sources: unknown[]
  output_contract: unknown
  skills: unknown[]
  tool_ids: string[]
  max_steps_per_run: number
  max_cost_per_run_usd: number
}

const HINT_MARKER = '\n\n### OUTPUT FORMAT (V2)\n'

async function main() {
  const copilots = await pgrest<Copilot[]>(
    'GET',
    'copilots?select=id,slug,latest_version_id,model&tags=cs.{trading}',
  )
  const bySlug = new Map(copilots.map((c) => [c.slug, c]))
  const done: string[] = []
  const skipped: string[] = []

  for (const agent of ROSTER) {
    const c = bySlug.get(agent.slug)
    if (!c) {
      skipped.push(`${agent.slug} (not materialized)`)
      continue
    }
    // Idempotence: skip if a v0.2.0-draft version already exists for this copilot.
    const existing = await pgrest<Array<{ id: string }>>(
      'GET',
      `copilot_versions?select=id&copilot_id=eq.${encodeURIComponent(c.id)}&label=eq.v0.2.0-draft`,
    )
    if (existing.length > 0) {
      skipped.push(`${agent.slug} (v0.2.0 exists)`)
      continue
    }

    // Load the current manifest (the one latest_version_id points at).
    const verRows = await pgrest<Array<{ manifest_id: string }>>(
      'GET',
      `copilot_versions?select=manifest_id&id=eq.${encodeURIComponent(c.latest_version_id)}`,
    )
    const manifestId = verRows[0]?.manifest_id
    if (!manifestId) {
      skipped.push(`${agent.slug} (no manifest)`)
      continue
    }
    const mRows = await pgrest<Manifest[]>(
      'GET',
      `manifests?id=eq.${encodeURIComponent(manifestId)}`,
    )
    const m = mRows[0]
    if (!m) {
      skipped.push(`${agent.slug} (manifest row missing)`)
      continue
    }

    const hint = CONTRACT_PROMPT_HINTS[agent.outputContract.schemaName]
    const basePrompt = m.system_prompt_summary.split(HINT_MARKER)[0]
    const newPrompt = `${basePrompt}${HINT_MARKER}${hint}`

    const now = new Date().toISOString()
    const suffix = crypto.randomUUID().slice(0, 8)
    const newManifestId = makeId('manifest', `${agent.slug}-v2-${suffix}`)
    const newVersionId = makeId('version', `${agent.slug}-v2-${suffix}`)

    // New manifest (same tools, patched prompt).
    await pgrest('POST', 'manifests', {
      id: newManifestId,
      copilot_id: c.id,
      version: 'v0.2.0-draft',
      system_prompt_summary: newPrompt,
      allowed_routes: m.allowed_routes,
      forbidden_actions: m.forbidden_actions,
      confirmation_policy: m.confirmation_policy,
      always_confirm_actions: m.always_confirm_actions,
      memory_sources: m.memory_sources ?? [],
      output_contract: m.output_contract,
      skills: m.skills ?? [],
      tool_ids: m.tool_ids,
      max_steps_per_run: m.max_steps_per_run,
      max_cost_per_run_usd: m.max_cost_per_run_usd,
      updated_at: now,
    })
    // New version pointing at the new manifest.
    await pgrest('POST', 'copilot_versions', {
      id: newVersionId,
      copilot_id: c.id,
      label: 'v0.2.0-draft',
      stage: 'draft',
      manifest_id: newManifestId,
      model: c.model,
      model_provider: 'openai',
      changelog: 'V2 — precise per-contract JSON output hint appended to the system prompt (JSON-only, exact field types).',
      created_at: now,
      created_by: 'aig-trade-001-improve',
      scores: { testPassRate: 0, benchmarkScore: 0, shadowAgreement: null, unsafeActionCount: 0 },
    })
    // Move latest_version_id to V2.
    await pgrest('PATCH', `copilots?id=eq.${encodeURIComponent(c.id)}`, {
      latest_version_id: newVersionId,
      updated_at: now,
    })
    done.push(`${agent.slug} -> ${newVersionId}`)
    console.log(`V2 created for ${agent.slug}: ${newVersionId}`)
  }

  console.log(JSON.stringify({ done, skipped }, null, 2))
}

main().catch((e) => {
  console.error('improve-trading-v2 failed:', e)
  process.exit(1)
})
