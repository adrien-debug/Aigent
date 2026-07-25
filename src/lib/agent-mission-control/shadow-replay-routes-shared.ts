/**
 * Agent Mission Control — shared support for the shadow/replay API routes
 * (server only).
 *
 * AIGENT-FACTORY-SHADOW-REPLAY-001. Both
 * `copilots/[copilotId]/versions/[versionId]/shadow` and `.../replay` need the
 * exact same guard sequence — id shape, live-backend check, IDOR ownership,
 * archived-at-launch, corpus validation. Factoring it once keeps the two
 * routes from silently drifting on any one of these checks.
 *
 * HISTORY: an earlier version exported `buildRunCallback` (driving the direct/
 * model-router runtime as a stand-in) and `localDeterministicRunAgent`, both
 * removed — substituting the direct runtime for a langgraph candidate's own
 * graph would never faithfully evaluate its manifest. Real (non-fixture)
 * execution now goes through the LangGraph ephemeral-assistant seam
 * (`ensureCandidateAssistant`), wired at the route layer via
 * shadow-live.ts / replay-live.ts (`useFixture:false` → `execution_mode:
 * 'live_langgraph'`). The fixture path remains the $0 default.
 */
import 'server-only'

import { pgrest } from './postgrest'

/**
 * Shape guard for `:copilotId` / `:versionId` — identical to the ID_RE used by
 * every sibling copilot route (promotion/route.ts, run/route.ts): lowercase
 * alphanumerics/hyphens only, bounded length. Rejects anything that could be
 * misparsed by a PostgREST `in.(...)`/`eq.` filter (e.g. an embedded comma)
 * before it ever reaches a live DB round-trip.
 */
export const ID_RE = /^[a-z0-9-]{1,200}$/

export function isValidId(id: string): boolean {
  return typeof id === 'string' && ID_RE.test(id)
}

/** True when the live gpu1 backend is configured (same check every sibling route uses). */
export function liveBackendConfigured(): boolean {
  return (
    process.env.AMC_DATA_SOURCE === 'gpu1' &&
    !!process.env.AMC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export interface OwnedVersion {
  id: string
  copilotId: string
  stage: string
  runtime: string
  productionVersionId: string | null
}

/**
 * Load `versionId` and confirm it belongs to `copilotId` — same batched-query
 * + application-filter IDOR pattern as promotion/route.ts. Returns `null` on
 * ANY mismatch (wrong copilot, missing version, missing copilot) so the route
 * can return a single generic 404 that never distinguishes "doesn't exist"
 * from "belongs to someone else".
 */
export async function loadOwnedVersion(copilotId: string, versionId: string): Promise<OwnedVersion | null> {
  const [copilotRows, versionRows] = await Promise.all([
    pgrest<Record<string, unknown>[]>('GET', `copilots?id=eq.${encodeURIComponent(copilotId)}&select=id,runtime,production_version_id`),
    pgrest<Record<string, unknown>[]>('GET', `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=id,copilot_id,stage`),
  ])
  const copilot = copilotRows[0]
  if (!copilot) return null
  const version = versionRows[0]
  if (!version || version.copilot_id !== copilotId) return null
  return {
    id: version.id as string,
    copilotId,
    stage: version.stage as string,
    runtime: (copilot.runtime as string) ?? 'unknown',
    productionVersionId: (copilot.production_version_id as string | null) ?? null,
  }
}

/** Re-read a version's stage alone — used for the read-relate-write re-check right before persisting evidence. */
export async function readVersionStage(versionId: string): Promise<string | null> {
  const rows = await pgrest<Record<string, unknown>[]>('GET', `copilot_versions?id=eq.${encodeURIComponent(versionId)}&select=stage`)
  return (rows[0]?.stage as string | undefined) ?? null
}

/**
 * Validate the optional request-body corpus. An explicitly EMPTY array is
 * ALWAYS refused — it must never be silently substituted with a default and
 * read back as an accepted run. Missing (`undefined`) falls back to the small
 * deterministic default corpus (mirrors prove-factory-e2e.ts's count_words
 * fixture) ONLY because that default is itself deterministic, $0, and
 * side-effect free — a defensible default, not a silent one, since the route
 * always reports which corpus size ran.
 */
export function resolveCorpus(body: { inputs?: unknown; cases?: unknown }): { ok: true; inputs: unknown[] } | { ok: false } {
  const raw = body.inputs ?? body.cases
  if (raw === undefined) {
    return { ok: true, inputs: DEFAULT_CORPUS }
  }
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false }
  }
  return { ok: true, inputs: raw }
}

/** Deterministic, $0, zero-external-effect default corpus — same shape as promotion-fixtures.ts's makeFixtureShadowAgent expects. */
const DEFAULT_CORPUS: unknown[] = [{ text: 'the quick brown fox' }, { text: 'one two three four' }]
