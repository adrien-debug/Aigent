import { NextResponse } from 'next/server'

import {
  createCopilotFromManifest,
  deleteCopilotCascade,
  setCopilotAssistantId,
} from '@/lib/agent-mission-control/authoring-writes'
import type { CreateCopilotInput } from '@/lib/agent-mission-control/authoring-types'
import {
  deleteCopilotAssistant,
  ensureCopilotAssistant,
} from '@/lib/agent-mission-control/langgraph-assistants'

/**
 * POST /api/agent-ops/copilots — materialize a `CreateCopilotInput` (an
 * authoring draft's identity + Architect-generated manifest) into a REAL
 * copilot: a `copilots` row plus its `manifests`, `tools` and `copilot_versions`
 * rows. The multi-insert lives in one place — `createCopilotFromManifest`
 * (authoring-writes.ts) — which creates rows in FK-safe order (copilot first,
 * every child referencing it) and stamps required NOT NULL timestamps.
 *
 * AFTER the copilot + its manifest + tools exist, we provision the copilot's
 * DEDICATED LangGraph assistant (ensureCopilotAssistant): its config.configurable
 * is DERIVED from that manifest+tools (system prompt composed from the Architect
 * summary + forbidden actions + output contract, model, step budget,
 * confirmation policy, real tools scoped to the project repo). The assistant id
 * is persisted onto the copilot row (setCopilotAssistantId) so runs target it.
 * This is what turns the Architect's design into the copilot's live behaviour.
 *
 * Half-wired copilots are NOT allowed: if the assistant can't be created or its
 * id can't be persisted, we roll back best-effort (delete the just-created
 * assistant, cascade-delete the copilot) and return 502 — same shape as the
 * projects route does for its assistant.
 *
 * Live-only, fail-closed: without `AMC_DATA_SOURCE=gpu1` + Supabase env,
 * `createCopilotFromManifest` throws; we surface 503 rather than fake a
 * created copilot. Body validation mirrors ./[copilotId]/route.ts.
 */
export async function POST(request: Request) {
  let body: CreateCopilotInput
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.length > 200) {
    return NextResponse.json({ error: 'name is required (max 200 chars)' }, { status: 400 })
  }
  if (typeof body.slug !== 'string' || body.slug.trim().length === 0 || body.slug.length > 200) {
    return NextResponse.json({ error: 'slug is required (max 200 chars)' }, { status: 400 })
  }
  if (!body.manifest || typeof body.manifest !== 'object' || Array.isArray(body.manifest)) {
    return NextResponse.json({ error: 'manifest is required' }, { status: 400 })
  }
  if (body.projectId !== null && body.projectId !== undefined && typeof body.projectId !== 'string') {
    return NextResponse.json({ error: 'projectId must be a string or null' }, { status: 400 })
  }
  if (
    body.targetProjectIds !== undefined &&
    (!Array.isArray(body.targetProjectIds) ||
      body.targetProjectIds.some((id) => typeof id !== 'string') ||
      body.targetProjectIds.length > 2)
  ) {
    return NextResponse.json(
      { error: 'targetProjectIds must be an array of at most 2 strings' },
      { status: 400 }
    )
  }
  if (
    body.tags !== undefined &&
    (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== 'string') || body.tags.length > 50)
  ) {
    return NextResponse.json({ error: 'tags must be an array of at most 50 strings' }, { status: 400 })
  }
  // proposedTools drives an unbounded per-item INSERT loop in
  // createCopilotFromManifest — an oversized or malformed array must be
  // rejected here (400) rather than reach that loop, where a non-array value
  // throws a raw "is not iterable" TypeError (caught below, but as an opaque
  // 502) and an oversized array would fire hundreds of inserts per request.
  const proposedTools = (body.manifest as { proposedTools?: unknown }).proposedTools
  if (
    !Array.isArray(proposedTools) ||
    proposedTools.length > 50 ||
    proposedTools.some(
      (t) =>
        !t ||
        typeof t !== 'object' ||
        typeof (t as { name?: unknown }).name !== 'string' ||
        (t as { name: string }).name.trim().length === 0 ||
        (t as { name: string }).name.length > 200
    )
  ) {
    return NextResponse.json(
      { error: 'manifest.proposedTools must be an array of at most 50 tools, each with a non-empty name' },
      { status: 400 }
    )
  }

  // Fail-closed 503 when the live backend is not configured — never fake success.
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // 1) Create the copilot (+ manifest + tools + version). A failure here is a
  //    plain 502 (nothing to undo — the multi-insert is fail-closed). Internal
  //    errors (PostgREST status/path/body) are logged server-side only — the
  //    client gets a generic message, matching projects/route.ts and the
  //    sibling [copilotId]/route.ts DELETE handler.
  let copilotId: string
  try {
    copilotId = await createCopilotFromManifest(body)
  } catch (err) {
    console.error('[agent-ops/copilots] createCopilotFromManifest failed:', err)
    return NextResponse.json({ error: 'copilot creation failed' }, { status: 502 })
  }

  // 2) Provision the copilot's dedicated assistant (config derived from the
  //    manifest+tools just written) and persist its id. On failure, roll back
  //    best-effort (assistant then copilot cascade) so no half-wired copilot
  //    survives, and surface a clear 502.
  let assistantId: string
  try {
    assistantId = await ensureCopilotAssistant({ copilotId })
  } catch (err) {
    console.error('[agent-ops/copilots] ensureCopilotAssistant failed:', err)
    await deleteCopilotCascade(copilotId).catch(() => {})
    return NextResponse.json(
      { error: 'copilot assistant provisioning failed' },
      { status: 502 }
    )
  }

  try {
    await setCopilotAssistantId(copilotId, assistantId)
  } catch (err) {
    // The copilot exists but couldn't be linked to its assistant — undo both so
    // the caller can retry cleanly rather than inherit an unlinked copilot.
    console.error('[agent-ops/copilots] setCopilotAssistantId failed:', err)
    await deleteCopilotAssistant(assistantId).catch(() => {})
    await deleteCopilotCascade(copilotId).catch(() => {})
    return NextResponse.json(
      { error: 'failed to link copilot to its assistant' },
      { status: 502 }
    )
  }

  // assistantId is additive (non-breaking): existing clients read only copilotId.
  return NextResponse.json({ ok: true, copilotId, assistantId }, { status: 201 })
}
