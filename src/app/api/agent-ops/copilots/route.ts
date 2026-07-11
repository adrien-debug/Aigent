import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import type { CreateCopilotInput } from '@/lib/agent-mission-control/authoring-types'

/**
 * POST /api/agent-ops/copilots — materialize a `CreateCopilotInput` (an
 * authoring draft's identity + generated manifest) into a REAL copilot:
 * a `manifests` row, a `copilot_versions` row pointing at it, and a
 * `copilots` row pointing at both (production_version_id + latest_version_id
 * set to the new version). Writes go straight to the gpu1 PostgREST
 * perimeter (service_role, server only).
 *
 * Live-only, fail-closed: without `AMC_DATA_SOURCE=gpu1` + Supabase env,
 * refuse with 503 rather than fake a created copilot.
 *
 * Mirrors ./[copilotId]/route.ts's PATCH handler for body validation and
 * error-handling shape. Single-owner file: PostgREST helpers are inlined
 * here rather than imported from a shared lib (same convention as
 * runner.ts and run/route.ts).
 */

function requireBackend(): { base: string; key: string } | null {
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return null
  }
  return { base, key }
}

/** POST a row to a PostgREST table and return the inserted representation. */
async function insertRow<T extends Record<string, unknown>>(
  base: string,
  key: string,
  table: string,
  body: Record<string, unknown>
): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`PostgREST ${res.status} on ${table}: ${(await res.text()).slice(0, 300)}`)
  }
  const rows = (await res.json()) as T[]
  return rows[0]
}

export async function POST(request: Request) {
  let body: CreateCopilotInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 })
  }
  if (typeof body.slug !== 'string' || body.slug.trim().length === 0) {
    return NextResponse.json({ error: 'slug is required' }, { status: 400 })
  }
  if (!body.manifest || typeof body.manifest !== 'object') {
    return NextResponse.json({ error: 'manifest is required' }, { status: 400 })
  }

  const backend = requireBackend()
  if (!backend) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  const { base, key } = backend

  const copilotId = randomUUID()
  const versionId = randomUUID()
  const manifestId = randomUUID()

  try {
    const manifest = body.manifest

    // 1) manifests — FK target for copilot_versions.manifest_id.
    await insertRow(base, key, 'manifests', {
      id: manifestId,
      copilot_id: copilotId,
      version: 'v1',
      system_prompt_summary: manifest.systemPromptSummary,
      allowed_routes: manifest.allowedRoutes,
      forbidden_actions: manifest.forbiddenActions,
      confirmation_policy: manifest.confirmationPolicy,
      always_confirm_actions: manifest.alwaysConfirmActions,
      memory_sources: [],
      output_contract: manifest.outputContract,
      tool_ids: [],
      max_steps_per_run: manifest.maxStepsPerRun,
      max_cost_per_run_usd: manifest.maxCostPerRunUsd,
    })

    // 2) copilot_versions — FK target for copilots.production/latest_version_id.
    await insertRow(base, key, 'copilot_versions', {
      id: versionId,
      copilot_id: copilotId,
      label: 'v1.0.0',
      stage: 'draft',
      manifest_id: manifestId,
      model: body.model,
      model_provider: body.modelProvider,
      changelog: 'Initial version created via the agent-authoring Architect.',
      created_by: body.owner,
      scores: {
        testPassRate: 0,
        benchmarkScore: 0,
        shadowAgreement: null,
        unsafeActionCount: 0,
      },
    })

    // 3) copilots — the real copilot row, pointing at the version above.
    await insertRow(base, key, 'copilots', {
      id: copilotId,
      project_id: body.projectId,
      target_project_ids: body.targetProjectIds,
      name: body.name,
      slug: body.slug,
      description: body.description,
      runtime: body.runtime,
      status: 'draft',
      production_version_id: null,
      latest_version_id: versionId,
      model: body.model,
      model_provider: body.modelProvider,
      owner: body.owner,
      tags: body.tags,
      health: {
        testPassRate: 0,
        benchmarkScore: 0,
        runsLast24h: 0,
        errorRateLast24h: 0,
        avgLatencyMs: 0,
        costLast24hUsd: 0,
        openWarnings: 0,
      },
      created_via: 'architect',
    })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'copilot creation failed' },
      { status: 502 }
    )
  }

  return NextResponse.json({ ok: true, copilotId }, { status: 201 })
}
