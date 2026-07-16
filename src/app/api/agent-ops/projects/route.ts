import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  createProject,
  deleteProjectCascade,
  setProjectAssistantId,
} from '@/lib/agent-mission-control/authoring-writes'
import type { CreateProjectInput } from '@/lib/agent-mission-control/authoring-writes'
import {
  deleteProjectAssistant,
  ensureProjectAssistant,
} from '@/lib/agent-mission-control/langgraph-assistants'
import { slugify } from '@/lib/agent-mission-control/slug'

const PLATFORMS: ReadonlyArray<CreateProjectInput['platform']> = [
  'web',
  'desktop',
  'mobile',
  'api',
]

/**
 * `owner/name` only: alnum + `. _ -` per segment, exactly one `/`. Rejects
 * `..` path-traversal segments, extra slashes, and query/fragment/whitespace
 * injection (`?`, `#`, `@`, spaces) — this string is later interpolated
 * verbatim into GitHub API URLs by the Agent Server's tool registry
 * (src/langgraph/tool-registry.mjs), so anything outside this shape is a
 * scope-escape vector, not just a cosmetic validation nicety.
 */
const REPO_FULL_NAME_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/

const repoFullNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(REPO_FULL_NAME_RE, 'repoFullName must look like "owner/name" (no "..", "/", "?", "#", "@", or spaces)')
  .refine((v) => !v.split('/').some((segment) => segment === '.' || segment === '..'), {
    message: 'repoFullName segments must not be "." or ".."',
  })

/**
 * Mirrors slugify()'s core reduction (slug.ts): lowercase, collapse any run of
 * non-alphanumerics to nothing. Used only to detect the degenerate case here
 * (name/slug with zero alphanumeric characters — e.g. "!!!", emoji-only, or
 * CJK/unicode-only input) BEFORE createProject derives an empty slug from it.
 * `projects.slug` is `not null unique`: an empty-string slug is not null, so
 * it silently inserts once and then throws an opaque 502 (unique violation)
 * on the very next malformed name — a self-inflicted, hard-to-debug failure
 * mode with no clear validation error. Reject it here instead, with a plain
 * 400, before it ever reaches the DB.
 */
const hasSlugifiableContent = (v: string) => /[a-z0-9]/i.test(v)

/**
 * Length/shape bounds, aligned on the sibling routes' guards:
 *  - the project id is `proj-<slug>` and every child route
 *    (projects/[id]/**, push-agent) gates it with /^[a-z0-9-]{1,200}$/ —
 *    so slug (client-supplied OR slugify(name)-derived, which never grows
 *    the input) is capped at 195 chars ("proj-" eats 5) and a client slug
 *    must already be id-safe lowercase [a-z0-9-]. Without the shape check,
 *    createProject stores the slug VERBATIM: "My Slug!!" yields an id the
 *    child routes all 400 on — a project created but unreachable.
 *  - description/repoUrl land in the DB (and the name on the LangGraph
 *    assistant): bounded like builder/run/route.ts bounds its strings.
 */
const NAME_MAX = 195
const SLUG_RE = /^[a-z0-9-]+$/

/** Body contract for POST /api/agent-ops/projects. Mirrors CreateProjectInput. */
const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1, 'name is required').max(NAME_MAX, `name must be at most ${NAME_MAX} characters`),
    slug: z
      .string()
      .trim()
      .min(1)
      .max(NAME_MAX, `slug must be at most ${NAME_MAX} characters`)
      .regex(SLUG_RE, 'slug must contain only lowercase letters, digits, and hyphens')
      .optional(),
    description: z.string().max(4_000, 'description must be at most 4000 characters').optional(),
    platform: z.enum(PLATFORMS as [CreateProjectInput['platform'], ...CreateProjectInput['platform'][]], {
      message: "platform must be one of 'web' | 'desktop' | 'mobile' | 'api'",
    }),
    repoUrl: z.string().trim().max(2_000, 'repoUrl must be at most 2000 characters').url().optional(),
    repoFullName: repoFullNameSchema.optional(),
  })
  .refine((v) => v.slug === undefined || hasSlugifiableContent(v.slug), {
    message: 'slug must contain at least one letter or digit',
    path: ['slug'],
  })
  .refine((v) => v.slug !== undefined || hasSlugifiableContent(v.name), {
    message: 'name must contain at least one letter or digit (used to derive slug)',
    path: ['name'],
  })
  // Derived-slug length: slugify() can GROW exotic Unicode input (lowercase
  // expansion, e.g. "İ" → "i" + combining dot → "i-"), so a ≤195-char name
  // does not guarantee a ≤195-char derived slug. Check with the REAL slugify
  // (the one createProject uses) so the resulting `proj-<slug>` id always
  // passes the child routes' /^[a-z0-9-]{1,200}$/ guards.
  .refine((v) => v.slug !== undefined || slugify(v.name).length <= NAME_MAX, {
    message: `name derives a slug longer than ${NAME_MAX} characters — provide a shorter name or an explicit slug`,
    path: ['name'],
  })

/**
 * POST /api/agent-ops/projects — LIVE creation of a project linked to a GitHub
 * repo. Two coupled effects, in order:
 *   1. materialize a real `projects` row via `createProject` (authoring-writes.ts);
 *   2. create the project's DEDICATED assistant on the shared `agent_builder`
 *      graph of the LangGraph Agent Server (ensureProjectAssistant), then persist
 *      its `assistant_id` back onto the row (setProjectAssistantId).
 * The assistant makes each project a distinct entity in LangGraph Studio, and
 * runs of a copilot attached to the project dispatch through it (see runner.ts).
 *
 * Live-only, fail-closed: without `AMC_DATA_SOURCE=gpu1` + Supabase env we
 * return 503 rather than fake a created project.
 *
 * Half-wired projects are NOT allowed: if the assistant can't be created (or its
 * id can't be persisted), we roll back best-effort — delete the just-created
 * assistant if any, cascade-delete the project row — and return 502. A project
 * without its assistant would silently fall back to the shared graph at run time,
 * hiding the failure; failing loudly is the honest choice.
 */
export async function POST(request: Request) {
  let rawBody: unknown
  try {
    rawBody = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  const parsed = createProjectBodySchema.safeParse(rawBody)
  if (!parsed.success) {
    // Preserve the exact legacy messages for the two checks callers may already
    // depend on; fall back to the first zod issue for everything else (notably
    // repoFullName / repoUrl shape).
    const issues = parsed.error.issues
    // Only the base "name" shape check (empty/missing) keeps the legacy
    // hardcoded message; other name failures (too long — 'too_big' — and the
    // "no alphanumeric content" custom refine) must surface their own message,
    // they are different failures, not an absent name.
    const nameIssue = issues.find(
      (i) => i.path[0] === 'name' && (i.code === 'too_small' || i.code === 'invalid_type')
    )
    const platformIssue = issues.find((i) => i.path[0] === 'platform')
    const message = nameIssue
      ? 'name is required'
      : platformIssue
        ? "platform must be one of 'web' | 'desktop' | 'mobile' | 'api'"
        : (issues[0]?.message ?? 'invalid request body')
    return NextResponse.json({ error: message }, { status: 400 })
  }
  const body: CreateProjectInput = parsed.data

  // Fail-closed 503 when the live backend is not configured — never fake success.
  if (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  // 1) Create the project row. A failure here is a plain 502 (nothing to undo)
  //    — or 504 when pgrest()'s 30s timeout fired —
  //    EXCEPT a unique-violation on the row's id: ids are deterministic
  //    (`makeId('proj', slug)`, see slug.ts), so a name/slug that collides with
  //    an existing project makes PostgREST reject the insert with 409 — a
  //    client-caused conflict, not an upstream failure. Detect it from the
  //    thrown message the same way projects/[id]/push-agent/route.ts does for
  //    GitHub's ref race, and surface 409 instead of a misleading 502.
  //    Internal errors (PostgREST status/path/body, stack traces) are logged
  //    server-side only — the client gets a generic message so no DB/table/
  //    query detail ever leaks over the wire.
  let projectId: string
  try {
    projectId = await createProject(body)
  } catch (err) {
    console.error('[agent-ops/projects] createProject failed:', err)
    const message = err instanceof Error ? err.message : ''
    if (/PostgREST 409 on POST projects/.test(message)) {
      return NextResponse.json(
        { error: 'a project with this name/slug already exists' },
        { status: 409 }
      )
    }
    // pgrest() aborts a hung round-trip after 30s and rethrows PgrestError(504)
    // ("PostgREST 504 on <method> <path>"): surface it as a gateway TIMEOUT,
    // not a generic upstream failure.
    if (/^PostgREST 504 on /.test(message)) {
      return NextResponse.json({ error: 'project creation timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: 'project creation failed' }, { status: 502 })
  }

  // 2) Create the project's dedicated assistant and persist its id. On failure,
  //    roll back best-effort (assistant then project row) so no half-wired
  //    project survives, and surface a clear 502.
  let assistantId: string
  try {
    assistantId = await ensureProjectAssistant({
      projectId,
      name: body.name,
      metadata: { repoFullName: body.repoFullName ?? null },
    })
  } catch (err) {
    console.error('[agent-ops/projects] ensureProjectAssistant failed:', err)
    await deleteProjectCascade(projectId).catch(() => {})
    return NextResponse.json(
      { error: 'project assistant provisioning failed' },
      { status: 502 }
    )
  }

  try {
    await setProjectAssistantId(projectId, assistantId)
  } catch (err) {
    // The row exists but couldn't be linked to its assistant — undo both so the
    // caller can retry cleanly rather than inherit an unlinked project.
    console.error('[agent-ops/projects] setProjectAssistantId failed:', err)
    await deleteProjectAssistant(assistantId).catch(() => {})
    await deleteProjectCascade(projectId).catch(() => {})
    // Same 504-vs-502 split as the createProject catch above: a pgrest()
    // timeout is a gateway timeout, any other backend failure a generic 502.
    const message = err instanceof Error ? err.message : ''
    return NextResponse.json(
      { error: 'failed to link project to its assistant' },
      { status: /^PostgREST 504 on /.test(message) ? 504 : 502 }
    )
  }

  // assistantId is additive (non-breaking): existing clients read only projectId.
  return NextResponse.json({ ok: true, projectId, assistantId }, { status: 201 })
}
