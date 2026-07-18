/**
 * Project Team Canvas — the WRITE path for `project_agent_relations`.
 *
 * Server-only, live-only (same PostgREST perimeter as the rest of
 * `project-team/`). Reused by both route handlers
 * (`api/agent-ops/projects/[id]/relations/route.ts` POST and
 * `.../relations/[relationId]/route.ts` DELETE) so the security-critical
 * logic lives in exactly one place, is unit-testable without a Next.js
 * request/response, and cannot drift between the two handlers.
 *
 * ============================ THE CRITICAL INVARIANT ============================
 *
 * Migration 0019 states it plainly: the DB *will* accept a
 * `project_agent_relations` row whose `source_copilot_id`/`target_copilot_id`
 * belong to a DIFFERENT project than `project_id` — there is no FK/CHECK
 * tying the three together. `relations.ts` only rejects such a row at READ
 * time (silently dropped, never rendered — see its "Level 1: EXPLICIT"
 * comment). A write path that skipped this check would therefore create rows
 * that are perfectly valid SQL, permanently invisible on the canvas, and
 * inexplicable to whoever finds them later.
 *
 * `verifyRelationEndpoints` is the one function in this module responsible
 * for closing that hole on the WRITE side: it re-reads both copilots and
 * requires each one's OWN `project_id` to equal the project the relation is
 * being attached to. Both route handlers must call it (POST does, via the
 * insert path; DELETE does not need to — see its own project_id scoping
 * below) before ever touching `project_agent_relations`.
 *
 * The same discipline applies to DELETE: scoping by `id` alone would let a
 * caller delete another project's relation by guessing/enumerating a UUID.
 * `deleteProjectAgentRelation` scopes by BOTH `id` AND `project_id` in the
 * same PostgREST filter, so a mismatched project id can never match a row —
 * it 404s exactly like an unknown id would.
 */
import 'server-only'

import { randomUUID } from 'node:crypto'

import { z } from 'zod'

import { camelRows, pgrest, pgrestDetail } from '../postgrest'
import { EXPLICIT_RELATION_TYPES } from './relations'
import type { ProjectTeamEdgeRelation } from './types'

// ---------------------------------------------------------------------------
// Id shape guards
// ---------------------------------------------------------------------------

/**
 * Shape guard for a copilot id — same family as every sibling route
 * (`COPILOT_ID_RE` in copilots/[copilotId]/route.ts and friends): copilot ids
 * are `makeId('copilot', slug)`, lowercase alphanumerics/hyphens, bounded.
 */
const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/

/**
 * `project_agent_relations.id` has no natural slug (no `makeId()` prefix for
 * this table), so it is minted here with `randomUUID()` — the repo's own
 * precedent for ids with nothing to derive a slug from (see
 * `copilots/[copilotId]/runs/ingest/route.ts` and
 * `copilots/[copilotId]/runs/[runId]/resume/route.ts`, both of which mint and
 * validate bare UUIDs the same way).
 */
export const RELATION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidRelationId(id: unknown): id is string {
  return typeof id === 'string' && RELATION_ID_RE.test(id)
}

// ---------------------------------------------------------------------------
// POST body
// ---------------------------------------------------------------------------

/**
 * Body contract for `POST /api/agent-ops/projects/:id/relations`.
 *
 * `.strict()`: an unknown key — in particular a caller-smuggled `projectId`
 * or `id` — fails validation instead of being silently accepted and ignored.
 * The project a relation belongs to is ALWAYS the path param; the body must
 * never be able to choose it.
 *
 * `relationType` reuses `EXPLICIT_RELATION_TYPES` (relations.ts) rather than
 * restating the 5 storable values — `project-membership`, `team-membership`
 * and `shares-tool` are DERIVED edge kinds with no backing row and must never
 * be accepted here; rejecting them with a clean 400 (via this schema, before
 * the request ever reaches PostgREST) is cheaper and clearer than surfacing
 * whatever opaque code the `relation_type` CHECK constraint returns.
 *
 * The self-edge rule (`source !== target`) is enforced HERE, not left to the
 * DB's `project_agent_relations_no_self_edge` CHECK: a caller-facing 400 with
 * a clear message beats a bare constraint-violation 4xx from PostgREST.
 */
export const createRelationBodySchema = z
  .object({
    sourceCopilotId: z
      .string()
      .trim()
      .min(1, 'sourceCopilotId is required')
      .max(200, 'sourceCopilotId must be at most 200 characters')
      .regex(COPILOT_ID_RE, 'sourceCopilotId must look like a copilot id'),
    targetCopilotId: z
      .string()
      .trim()
      .min(1, 'targetCopilotId is required')
      .max(200, 'targetCopilotId must be at most 200 characters')
      .regex(COPILOT_ID_RE, 'targetCopilotId must look like a copilot id'),
    relationType: z.enum(
      EXPLICIT_RELATION_TYPES as [ProjectTeamEdgeRelation, ...ProjectTeamEdgeRelation[]],
      { message: `relationType must be one of ${EXPLICIT_RELATION_TYPES.join(', ')}` }
    ),
    /**
     * Optional, but a BLANK label (empty after trim, or whitespace-only) is
     * deliberately treated the same as an ABSENT one — `.transform()` folds
     * it to `undefined` rather than failing with 400. Rationale: the dialog
     * never sends `""` (its input is a plain optional text field with no
     * "clear" affordance that submits blank), so this only matters for a
     * direct API caller — and for that caller, silently storing "no label"
     * is kinder than a hard rejection for what is, functionally, the same
     * intent as omitting the field. This also closes the bug where a stored
     * `''` reached the DB and rendered as a visibly empty label instead of
     * falling back to the relation-type default (`edge.label ?? DEFAULT`
     * in the canvas only substitutes on null/undefined, never on `''`).
     *
     * A null byte (\u0000) is rejected explicitly with a clean 400 rather
     * than left to fail at the DB (Postgres `text` rejects null bytes with
     * error 22021, which would otherwise surface as an opaque generic 502).
     */
    label: z
      .string()
      .trim()
      .max(200, 'label must be at most 200 characters')
      .refine((v) => !v.includes('\0'), { message: 'label must not contain a null byte' })
      .optional()
      .transform((v) => (v && v.length > 0 ? v : undefined)),
  })
  .strict()
  .refine((v) => v.sourceCopilotId !== v.targetCopilotId, {
    message: 'sourceCopilotId and targetCopilotId must differ (no self-edge)',
    path: ['targetCopilotId'],
  })

export type CreateRelationBody = z.infer<typeof createRelationBodySchema>

// ---------------------------------------------------------------------------
// Endpoint ownership verification — THE cross-project write guard
// ---------------------------------------------------------------------------

interface CopilotProjectRow {
  id: string
  projectId: string | null
}

export type EndpointVerification = { ok: true } | { ok: false; invalidIds: string[] }

/**
 * Verify that BOTH `sourceCopilotId` and `targetCopilotId` are copilots whose
 * OWN `project_id` equals `projectId`. One batched `id=in.(...)` query, never
 * two round trips. An id that does not exist at all is treated the same as an
 * id belonging to another project — both land in `invalidIds`, and the caller
 * maps either case to 422 (the caller named an agent that is not in this
 * project, whether because it belongs elsewhere or does not exist).
 */
export async function verifyRelationEndpoints(
  projectId: string,
  sourceCopilotId: string,
  targetCopilotId: string
): Promise<EndpointVerification> {
  const ids = [...new Set([sourceCopilotId, targetCopilotId])]
  const rows = camelRows<CopilotProjectRow>(
    await pgrest<Record<string, unknown>[]>(
      'GET',
      `copilots?select=id,project_id&id=in.(${ids.map((id) => encodeURIComponent(id)).join(',')})`
    )
  )
  const byId = new Map(rows.map((row) => [row.id, row]))

  const invalidIds: string[] = []
  for (const id of [sourceCopilotId, targetCopilotId]) {
    const row = byId.get(id)
    if (!row || row.projectId !== projectId) invalidIds.push(id)
  }
  return invalidIds.length === 0 ? { ok: true } : { ok: false, invalidIds: [...new Set(invalidIds)] }
}

// ---------------------------------------------------------------------------
// Insert
// ---------------------------------------------------------------------------

export interface InsertRelationInput {
  /** ALWAYS the path project id — never taken from the request body. */
  projectId: string
  sourceCopilotId: string
  targetCopilotId: string
  relationType: ProjectTeamEdgeRelation
  label?: string
}

/**
 * Match a PostgREST error `code` field, tolerant of a pretty-printed body
 * (`"code": "23505"`, space after the colon) as well as the compact form
 * (`"code":"23505"`). The naive substring check this replaced only matched
 * the compact form — a PostgREST build (or a future upgrade) that
 * pretty-prints its error JSON would silently miss every match, and every
 * caller of `isUniqueViolation`/`isForeignKeyViolation` would fall through
 * to the generic 502 instead of the intended 409/422.
 *
 * Assumption carried forward from the pre-existing helper this generalizes:
 * `project_agent_relations` has exactly one UNIQUE constraint
 * (`project_agent_relations_unique_edge`) and exactly one FK pair (source +
 * target copilot), so a `23505`/`23503` code in this table's error body is
 * unambiguous — no need to also match the constraint name.
 */
function pgrestErrorCodeIs(err: unknown, code: string): boolean {
  return new RegExp(`"code"\\s*:\\s*"${code}"`).test(pgrestDetail(err))
}

/**
 * True iff `err` is the PgrestError PostgREST raises for a unique-violation
 * (Postgres code `23505`) — here, the
 * `project_agent_relations_unique_edge` constraint on
 * `(project_id, source_copilot_id, target_copilot_id, relation_type)`.
 * Sniffed from the server-side-only detail body (same precedent as
 * `copilots/route.ts`'s `23503`/`23505` classification); the raw detail
 * itself is never returned to the client.
 */
export function isUniqueViolation(err: unknown): boolean {
  return pgrestErrorCodeIs(err, '23505')
}

/**
 * True iff `err` is the PgrestError PostgREST raises for a foreign-key
 * violation (Postgres code `23503`) on `project_agent_relations` — the
 * `source_copilot_id`/`target_copilot_id` FKs. This is a genuine race, not a
 * client mistake: `verifyRelationEndpoints` confirms both copilots exist and
 * belong to this project, but the target (or source) copilot can be deleted
 * in the window between that check and this insert. The caller maps this to
 * 422 (client-actionable — "pick different agents"), never the generic 502 a
 * server-fault code would imply.
 */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgrestErrorCodeIs(err, '23503')
}

/**
 * Insert one explicit relation row. `id` is minted here (`randomUUID()`);
 * `project_id` is always `input.projectId` — the caller must resolve that
 * from the URL path, never from the request body (see
 * `createRelationBodySchema`'s `.strict()` note). `is_active` starts `true`:
 * a freshly configured relation is enabled by default, same as every other
 * "created" row in this schema.
 *
 * Throws (never fabricates success) on any PostgREST failure — callers map a
 * `23505` unique violation to 409 via `isUniqueViolation`, a `23503`
 * foreign-key violation to 422 via `isForeignKeyViolation` (an endpoint
 * copilot vanished between `verifyRelationEndpoints` and this insert), and
 * everything else to 502/504 via `isPgrestTimeout`.
 */
export async function insertProjectAgentRelation(input: InsertRelationInput): Promise<string> {
  const id = randomUUID()
  await pgrest('POST', 'project_agent_relations', {
    id,
    project_id: input.projectId,
    source_copilot_id: input.sourceCopilotId,
    target_copilot_id: input.targetCopilotId,
    relation_type: input.relationType,
    label: input.label ?? null,
    is_active: true,
  })
  return id
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete one relation, scoped by BOTH `id` AND `project_id` in the same
 * PostgREST filter — never `id` alone. Scoping by id alone would let an
 * authenticated caller delete another project's relation simply by guessing
 * or enumerating a UUID; that is the same class of bug as the cross-project
 * WRITE this module guards against above, just on the delete side.
 *
 * `pgrest()` on a DELETE that matches nothing returns an EMPTY ARRAY, not a
 * 404 (PostgREST convention) — this function returns `false` in that case so
 * the route can synthesize the 404 itself. A mismatched `projectId` for an
 * otherwise-real `relationId` produces exactly the same empty result as an
 * unknown id: the filter simply never matches, so the two cases are
 * indistinguishable to the caller by design (no oracle for "this id exists in
 * SOME other project").
 */
export async function deleteProjectAgentRelation(projectId: string, relationId: string): Promise<boolean> {
  const rows = await pgrest<Record<string, unknown>[]>(
    'DELETE',
    `project_agent_relations?id=eq.${encodeURIComponent(relationId)}&project_id=eq.${encodeURIComponent(projectId)}`
  )
  return rows.length > 0
}
