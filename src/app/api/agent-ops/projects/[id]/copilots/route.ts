import { NextResponse } from 'next/server'

import { getCopilots, getManifestForCopilot, getToolsForCopilot } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'
import { isValidProjectId } from '@/lib/agent-mission-control/resource-ids'
import type { Copilot } from '@/lib/agent-mission-control/types'

/**
 * GET /api/agent-ops/projects/:id/copilots — the real, authorized catalog of
 * copilots assigned to a project. This is the read surface an external
 * consumer (e.g. a partner platform) is meant to call to list the copilots it
 * is allowed to see — scoped strictly by `project_id`, never a global dump.
 *
 * Reuses `getCopilots`/`getManifestForCopilot`/`getToolsForCopilot` (the same
 * live PostgREST reads the admin dashboard already uses) instead of adding a
 * second data path. Live-only, fail-closed: no backend configured → 503, a
 * project with zero assigned copilots → `{ copilots: [] }` (not an error).
 *
 * Auth: gated by the existing `/api/agent-ops/**` boundary in `proxy.ts`
 * (admin session OR `x-amc-key`) — no new auth mechanism introduced here.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params

  if (!isValidProjectId(projectId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  if (
    process.env.AMC_DATA_SOURCE !== 'gpu1' ||
    !process.env.AMC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return NextResponse.json({ error: 'live backend not configured' }, { status: 503 })
  }

  let copilots: Copilot[]
  try {
    copilots = (await getCopilots({ health: 'list' })).filter((c) => c.projectId === projectId)
  } catch (err) {
    console.error('[GET /api/agent-ops/projects/:id/copilots] failed to load copilots', err)
    return NextResponse.json({ error: 'failed to load copilots' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }

  try {
    const entries = await Promise.all(
      copilots.map(async (copilot) => {
        const [manifest, tools] = await Promise.all([
          getManifestForCopilot(copilot.id),
          getToolsForCopilot(copilot.id),
        ])
        return {
          id: copilot.id,
          name: copilot.name,
          description: copilot.description,
          projectId: copilot.projectId,
          projectName: null as string | null,
          version: manifest?.version ?? null,
          // 'active' | 'paused' | 'draft' | 'degraded' | 'archived' — verbatim
          // DB status, never coerced into a commercially-friendlier value.
          status: copilot.status,
          provider: copilot.modelProvider,
          model: copilot.model,
          capabilities: manifest?.skills.map((s) => s.label) ?? [],
          tools: tools.filter((t) => t.enabled).map((t) => t.name),
          inputSchema: null as unknown,
          outputSchema: manifest?.outputContract ?? null,
          requiresHumanApproval: manifest ? manifest.confirmationPolicy !== 'never' : null,
          readOnly: manifest ? manifest.forbiddenActions.length > 0 : null,
          lastRunAt: copilot.health?.runsLast24h ? copilot.updatedAt : null,
          successRate:
            copilot.health && copilot.health.runsLast24h > 0
              ? 1 - copilot.health.errorRateLast24h
              : null,
          costPolicy: manifest ? { maxCostPerRunUsd: manifest.maxCostPerRunUsd } : {},
          // Draft/archived copilots exist but are not meant to be run by an
          // external caller yet — only 'active' is offered as available.
          availability: copilot.status === 'active' ? 'available' : 'unavailable',
        }
      })
    )
    return NextResponse.json({ ok: true, projectId, copilots: entries })
  } catch (err) {
    console.error('[GET /api/agent-ops/projects/:id/copilots] failed to load manifest/tools', err)
    return NextResponse.json({ error: 'failed to load copilot detail' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
