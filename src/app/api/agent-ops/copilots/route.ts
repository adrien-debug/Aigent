import { after } from 'next/server'
import { NextResponse } from 'next/server'
import { z } from 'zod'

import { prepareAutoEval } from '@/lib/agent-mission-control/agent-autoeval'
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
import { pgrestDetail } from '@/lib/agent-mission-control/postgrest'

/**
 * Legacy validation messages, kept VERBATIM across the zod migration (same
 * strings the previous manual checks returned) so existing callers keep seeing
 * the exact errors they may already match on. Non-legacy issues get their
 * field path prefixed instead (see POST) so nested manifest errors stay
 * actionable ("manifest.maxStepsPerRun: …").
 */
const MSG = {
  body: 'invalid JSON body',
  name: 'name is required (max 200 chars)',
  slug: 'slug is required (max 200 chars)',
  manifest: 'manifest is required',
  projectId: 'projectId must be a string or null',
  targetProjectIds: 'targetProjectIds must be an array of at most 2 strings',
  tags: 'tags must be an array of at most 50 strings',
  proposedTools:
    'manifest.proposedTools must be an array of at most 50 tools, each with a non-empty name',
} as const
const LEGACY_MESSAGES = new Set<string>(Object.values(MSG))

/**
 * `slug` becomes the copilot id (`makeId('copilot', `${slug}-<8 hex>`)`, see
 * authoring-writes.ts) and the sibling [copilotId] route guards ids with
 * /^[a-z0-9-]{1,200}$/ — a slug outside that charset would create a copilot
 * whose own DELETE/PATCH route rejects its id (an unmanageable row). Max 183
 * = 200 − 'copilot-'(8) − '-'(1) − hex suffix(8), so the derived id always
 * fits the sibling guard.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,182}$/

/**
 * PgrestError from a PostgREST call that hit postgrest.ts's 30s AbortSignal
 * (or a real upstream gateway timeout). The prefix is the stable, safe summary
 * PgrestError always emits (`PostgREST <status> on <method> <path>`). A
 * timeout surfaces as 504 — not the generic 502 — because the write may STILL
 * have landed upstream: the caller must treat a retry as possibly conflicting
 * (409 on the slug), which "bad gateway" does not convey.
 */
const isUpstreamTimeout = (err: unknown) =>
  err instanceof Error && /^PostgREST 504 /.test(err.message)

const proposedToolSchema = z.object(
  {
    name: z
      .string({ message: MSG.proposedTools })
      .trim()
      .min(1, MSG.proposedTools)
      .max(200, MSG.proposedTools),
    description: z.string().max(2000, 'must be at most 2000 chars').default(''),
    // provider/risk_level are NOT NULL + CHECK in DB with no default — an
    // invalid or missing value must die here as a 400, not mid-multi-insert
    // as an opaque 502 that strands the already-created copilot + manifest.
    provider: z.enum(['internal', 'composio', 'mcp', 'http']),
    riskLevel: z.enum(['low', 'medium', 'high', 'critical']),
    // Mirrors the DB default (tools.requires_confirmation not null default false).
    requiresConfirmation: z.boolean().default(false),
  },
  { message: MSG.proposedTools }
)

/**
 * Full body contract for POST /api/agent-ops/copilots — every field of
 * CreateCopilotInput (authoring-types.ts) is type-checked AND bounded before
 * anything reaches the multi-insert (non-atomic: a mid-flight DB rejection
 * strands orphan rows) or the assistant's composed system prompt. Enum unions
 * mirror the DB CHECK constraints (types.ts); defaults mirror the DB column
 * defaults so previously-omittable fields stay omittable. proposedTools
 * drives a per-item INSERT loop in createCopilotFromManifest — an oversized
 * or malformed array must be rejected here (400) rather than reach that loop.
 * Mirrors the zod pattern of ../projects/route.ts.
 */
const createCopilotBodySchema = z.object(
  {
    name: z.string({ message: MSG.name }).trim().min(1, MSG.name).max(200, MSG.name),
    slug: z
      .string({ message: MSG.slug })
      .trim()
      .min(1, MSG.slug)
      .max(200, MSG.slug)
      .regex(SLUG_RE, 'must be 1-183 lowercase letters, digits or hyphens (it becomes the copilot id)'),
    description: z.string().max(4000, 'must be at most 4000 chars').default(''),
    runtime: z.enum(['langgraph', 'openai-assistants', 'gemini', 'custom']),
    model: z.string().max(200, 'must be at most 200 chars'),
    modelProvider: z.enum(['openai', 'google', 'mistral', 'local']),
    owner: z.string().max(200, 'must be at most 200 chars'),
    tags: z
      .array(z.string({ message: MSG.tags }).max(100, 'each tag must be at most 100 chars'), {
        message: MSG.tags,
      })
      .max(50, MSG.tags)
      .default([]),
    projectId: z
      .union([z.string().max(200, MSG.projectId), z.null()], { message: MSG.projectId })
      .default(null),
    targetProjectIds: z
      .array(
        z.string({ message: MSG.targetProjectIds }).max(200, 'each id must be at most 200 chars'),
        { message: MSG.targetProjectIds }
      )
      .max(2, MSG.targetProjectIds)
      .default([]),
    manifest: z.object(
      {
        systemPromptSummary: z.string().max(20000, 'must be at most 20000 chars').default(''),
        allowedRoutes: z.array(z.string().max(500)).max(100).default([]),
        forbiddenActions: z.array(z.string().max(1000)).max(100).default([]),
        confirmationPolicy: z.enum(['never', 'risky-only', 'always']),
        alwaysConfirmActions: z.array(z.string().max(1000)).max(100).default([]),
        outputContract: z.object({
          format: z.enum(['json', 'markdown', 'text', 'ui-actions']),
          schemaName: z.union([z.string().max(200), z.null()]).default(null),
          invariants: z.array(z.string().max(1000)).max(100).default([]),
        }),
        proposedTools: z
          .array(proposedToolSchema, { message: MSG.proposedTools })
          .max(50, MSG.proposedTools),
        skills: z
          .array(
            z.object({
              label: z.string().max(200, 'must be at most 200 chars'),
              detail: z.string().max(1000, 'must be at most 1000 chars').optional(),
            })
          )
          .max(50)
          .optional(),
        maxStepsPerRun: z.number().int().min(1).max(1000),
        maxCostPerRunUsd: z.number().min(0).max(10000),
      },
      { message: MSG.manifest }
    ),
  },
  { message: MSG.body }
)

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
 * created copilot. Body validated with the zod schema above (mirrors
 * ../projects/route.ts), every field bounded, legacy error messages preserved.
 */
export async function POST(request: Request) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = createCopilotBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    // Legacy messages are self-describing (kept verbatim for callers that may
    // match on them); anything else gets its field path prefixed so nested
    // manifest errors stay actionable.
    const message = !issue
      ? 'invalid request body'
      : LEGACY_MESSAGES.has(issue.message) || issue.path.length === 0
        ? issue.message
        : `${issue.path.join('.')}: ${issue.message}`
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const body: CreateCopilotInput = parsed.data

  // Fail-closed 503 when the live backend is not configured — never fake success.
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !process.env.AMC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // 1) Create the copilot (+ manifest + tools + version). A failure here is a
  //    plain 502 (nothing to undo — the multi-insert is fail-closed), EXCEPT:
  //    a unique-violation on `copilots.slug` (`not null unique` since 0001) —
  //    re-submitting the same slug, the double-submit case — is a 409
  //    client-caused conflict (mapped the same way ../projects/route.ts maps
  //    its deterministic-id collision); an FK violation on `project_id` (an
  //    unknown project) is a 404; a timed-out PostgREST call is a 504.
  //    Internal errors (PostgREST status/path/body) are logged server-side
  //    only — the client gets a generic message, matching projects/route.ts
  //    and the sibling [copilotId]/route.ts DELETE handler.
  let copilotId: string
  try {
    copilotId = await createCopilotFromManifest(body)
  } catch (err) {
    console.error('[agent-ops/copilots] createCopilotFromManifest failed:', err)
    const message = err instanceof Error ? err.message : ''
    if (/PostgREST 409 on POST copilots/.test(message)) {
      // PostgREST folds BOTH unique violations (23505 — duplicate slug) and FK
      // violations (23503 — projectId pointing at no `projects` row, the only
      // FK on `copilots`) into HTTP 409. Only the first is a real conflict;
      // the second is an unknown resource → 404. Classified on the code field
      // of the (server-side only) PostgREST body — never echoed to the client.
      if (pgrestDetail(err).includes('"code":"23503"')) {
        return NextResponse.json({ error: 'project not found' }, { status: 404 })
      }
      return NextResponse.json(
        { error: 'a copilot with this slug already exists' },
        { status: 409 }
      )
    }
    return NextResponse.json(
      { error: 'copilot creation failed' },
      { status: isUpstreamTimeout(err) ? 504 : 502 }
    )
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
      { status: isUpstreamTimeout(err) ? 504 : 502 }
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
      { status: isUpstreamTimeout(err) ? 504 : 502 }
    )
  }

  // Auto-evaluate the new agent: generate its suites now, run them after the
  // response via after() so its pass rate + score appear without a manual run.
  const runEval = await prepareAutoEval(copilotId)
  after(runEval)

  // assistantId is additive (non-breaking): existing clients read only copilotId.
  return NextResponse.json({ ok: true, copilotId, assistantId }, { status: 201 })
}
