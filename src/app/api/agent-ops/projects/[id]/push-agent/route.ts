import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'

import { setCopilotPushStatus } from '@/lib/agent-mission-control/authoring-writes'
import { getProject, getCopilot, getManifestForCopilot } from '@/lib/agent-mission-control/data'
import { persistDeliveryEvent } from '@/lib/agent-mission-control/delivery-events-store'
import { pushAgentToRepo, pushAgentToRepoPullRequest, type PushAgentDeliveryMode } from '@/lib/agent-mission-control/github'

// NOT-WIRED au front (volontaire, à garder) : aucun bouton UI ne déclenche le
// push. Conçue pour un usage HORS dashboard (script / API externe via x-amc-key)
// — d'où le garde-fou dry-run par défaut (écriture GitHub réelle seulement si
// `confirm:true` + GITHUB_PUSH_ENABLED=1). Pas du code mort.

/**
 * Shape guard for the `:id` path param and the body `copilotId`. Real ids are
 * `makeId(prefix, slug)` (slug.ts): lowercase alphanumerics/hyphens, bounded
 * length. Rejects empty/oversized/garbage before any live DB round-trip —
 * mirrors projects/[id]/route.ts's isValidProjectId and
 * copilots/[copilotId]/route.ts's isValidCopilotId. No valid id is ever refused.
 */
const ID_RE = /^[a-z0-9-]{1,200}$/

function isValidId(id: unknown): id is string {
  return typeof id === 'string' && ID_RE.test(id)
}

/**
 * POST /api/agent-ops/projects/:id/push-agent — push a copilot's agent artifacts
 * to the project's linked GitHub repository.
 *
 * Body: { copilotId: string; confirm?: boolean }
 *
 * OUTBOUND SAFEGUARD — DRY-RUN BY DEFAULT.
 * A REAL push (writes to the remote GitHub repo) requires BOTH:
 *   1. body.confirm === true, AND
 *   2. process.env.GITHUB_PUSH_ENABLED === '1'.
 * If either is missing, the push is ALWAYS a dry-run (no remote mutation) — the
 * route never accidentally mutates a customer repo.
 *
 * Fail-closed 503 if the gpu1 backend or GITHUB_TOKEN is not configured (mirrors
 * the copilot run route). Data/secrets are server-only; this route never runs on
 * the client.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  if (!isValidId(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  let body: { copilotId?: string; confirm?: boolean; deliveryMode?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!isValidId(body.copilotId)) {
    return NextResponse.json({ error: 'copilotId is required' }, { status: 400 })
  }
  const copilotId = body.copilotId
  // Delivery mode: pull_request is recommended; direct_commit stays available
  // but must be requested explicitly. Anything else defaults to pull_request.
  const deliveryMode: PushAgentDeliveryMode = body.deliveryMode === 'direct_commit' ? 'direct_commit' : 'pull_request'

  // Fail-closed: live gpu1 backend must be configured.
  const base = process.env.AMC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (process.env.AMC_DATA_SOURCE !== 'gpu1' || !base || !key) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }
  if (!process.env.GITHUB_TOKEN) {
    return NextResponse.json({ error: 'GitHub not configured' }, { status: 503 })
  }

  // Load the project — must exist and have a linked GitHub repo.
  let project
  try {
    project = await getProject(id)
  } catch (err) {
    // Never forward the raw PostgREST error text to the client: it can carry
    // schema/query internals. Log server-side, generic message to the caller
    // (same convention as copilots/[copilotId]/run and projects/[id] DELETE).
    console.error('[agent-ops/push-agent] failed to load project', err)
    return NextResponse.json({ error: 'failed to load project' }, { status: 502 })
  }
  if (!project) {
    return NextResponse.json({ error: 'project not found' }, { status: 404 })
  }
  if (!project.repoFullName) {
    return NextResponse.json(
      { error: 'project has no linked GitHub repo' },
      { status: 400 }
    )
  }

  // Load the copilot + its manifest.
  let copilot
  let manifest
  try {
    copilot = await getCopilot(copilotId)
    if (!copilot) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    manifest = await getManifestForCopilot(copilotId)
  } catch (err) {
    // Same rationale as above: don't leak raw PostgREST error text.
    console.error('[agent-ops/push-agent] failed to load copilot/manifest', err)
    return NextResponse.json({ error: 'failed to load copilot or manifest' }, { status: 502 })
  }
  if (!manifest) {
    return NextResponse.json({ error: 'copilot has no manifest' }, { status: 404 })
  }

  // Maturity gate: only a promoted production version may be pushed to a repo.
  // productionVersionId is written solely by a successful promotion, which
  // itself re-checks the live release-gate (tests 100% + benchmark + safety).
  // A draft that never passed tests must never land in a real repo.
  if (copilot.productionVersionId === null) {
    return NextResponse.json(
      {
        error:
          'copilot has no promoted production version — run its tests and promote a version before pushing to a repo',
      },
      { status: 422 }
    )
  }

  // Outbound safeguard: real push needs confirm:true AND GITHUB_PUSH_ENABLED=1.
  const dryRun = !(body.confirm === true && process.env.GITHUB_PUSH_ENABLED === '1')

  try {
    const runId = randomUUID().replace(/-/g, '').slice(0, 8)
    const result =
      deliveryMode === 'pull_request'
        ? await pushAgentToRepoPullRequest({ project, copilot, manifest, dryRun, runId })
        : await pushAgentToRepo({ project, copilot, manifest, dryRun })

    // Persist the delivery outcome — only for a REAL delivery (pushed && !dryRun).
    // A dry-run mutates nothing remotely, so there is nothing to record.
    // Best-effort: the GitHub write already succeeded, so a persistence failure
    // must NOT fail the response.
    if (result.pushed === true && result.dryRun === false) {
      try {
        // Legacy copilot-row status (kept for the overview's push receipt).
        await setCopilotPushStatus(copilotId, {
          lastPushStatus: 'pushed',
          lastPushedAt: new Date().toISOString(),
          lastPushCommitUrl: result.commitUrl ?? null,
        })
      } catch (statusErr) {
        console.error('[agent-ops/push-agent] failed to persist push status', statusErr)
      }
      try {
        await persistDeliveryEvent({
          id: `delivery_${runId}`,
          copilotId,
          versionId: copilot.productionVersionId ?? copilot.latestVersionId,
          projectId: copilot.projectId ?? null,
          mode: result.mode,
          targetRepo: project.repoFullName ?? '',
          targetBranch: result.baseBranch ?? result.branch,
          deliveryBranch: result.mode === 'pull_request' ? result.branch : null,
          commitSha: result.commitSha ?? null,
          commitUrl: result.commitUrl ?? null,
          prUrl: result.prUrl ?? null,
          prNumber: result.prNumber ?? null,
          status: 'delivered',
        })
      } catch (evtErr) {
        console.error('[agent-ops/push-agent] failed to persist delivery event', evtErr)
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'push failed'
    // Double-submit / concurrent-push race: two real pushes read the same
    // default-branch head commit, build two commits on top of it, then both
    // PATCH the ref with force:false. GitHub accepts the first and rejects
    // the second (422/409, non-fast-forward) — that's an expected outcome of
    // a race, not a backend failure, so surface it as 409 rather than 502
    // and tell the caller it's safe to retry (the branch has already moved).
    if (/GitHub (409|422) on PATCH .*\/git\/refs\/heads\//.test(message)) {
      return NextResponse.json(
        {
          error:
            'push conflict: the default branch advanced during this push (concurrent push?) — retry',
        },
        { status: 409 }
      )
    }
    // PR mode: the delivery branch already exists — a clean, retryable outcome.
    if (/^branch_exists:/.test(message)) {
      return NextResponse.json(
        { error: 'delivery branch already exists — retry (a new short id will be used)' },
        { status: 409 }
      )
    }
    // Never forward the raw error text to the client: pushAgentToRepo's message
    // can carry the internal GitHub API path + upstream response body. Log
    // server-side, generic message to the caller (same convention as the loads
    // above and the neighboring agent-ops routes).
    console.error('[agent-ops/push-agent] push failed', err)
    return NextResponse.json({ error: 'push failed' }, { status: 502 })
  }
}
