import { NextResponse } from 'next/server'

import { isPgrestTimeout, pgrestWithCount } from '@/lib/agent-mission-control/postgrest'
import {
  REGISTRY_HASH,
  RUNTIME_IDS,
  TOOL_IDS,
  getRuntime,
  getTool,
} from '@/lib/agent-mission-control/registry'

/**
 * GET /api/agent-ops/registry — the canonical registry, as the Factory reads it.
 *
 * AIGENT-CORE-FACTORY-035 (Phase 9). ONE authority, exposed once: the runtimes
 * (with real engine + availability) and the certified tools the Factory tool
 * picker offers, plus the registry hash so a client can tell which contract it
 * is looking at. The tool/runtime truth is PURE (no DB) — it comes straight from
 * the canonical registry, so it can never disagree with what a run will mount.
 *
 * The `counts` block is the only live-DB part: it powers the Factory landing
 * surface (how many drafts, tools, certified tools exist right now). Each count
 * is exact or `null` (never a truncated length) — a null renders as an honest
 * dash, never a fake zero. Auth is enforced upstream by proxy.ts.
 */
export async function GET() {
  const runtimes = RUNTIME_IDS.map((id) => {
    const r = getRuntime(id)!
    return {
      id: r.id,
      label: r.label,
      engine: r.engine,
      executable: r.engine !== 'none',
      creatable: r.creatable && r.engine !== 'none',
      capabilities: r.capabilities,
      modelProviders: r.modelProviders,
      note: r.note,
    }
  })

  const tools = TOOL_IDS.map((id) => {
    const t = getTool(id)!
    return {
      id: t.id,
      version: t.version,
      label: t.label,
      summary: t.summary,
      kind: t.kind,
      mutates: t.mutates,
      risk: t.risk,
      requiresConfirmation: t.requiresConfirmation,
      secretRefs: t.secretRefs,
      provenance: t.provenance,
      certification: t.certification,
    }
  })

  // Live counts for the Factory landing surface. Fail-soft: if the backend is
  // unreachable, counts are null (honest dash), the pure registry still serves.
  let counts: Record<string, number | null> = {
    agentDrafts: null,
    tools: null,
    certifiedTools: tools.filter((t) => t.certification === 'certified').length,
  }
  try {
    const [drafts, toolRows] = await Promise.all([
      pgrestWithCount('agent_drafts?select=id&limit=0'),
      pgrestWithCount('tools?select=id&limit=0'),
    ])
    counts = { ...counts, agentDrafts: drafts.count, tools: toolRows.count }
  } catch (err) {
    // Backend not configured / unreachable — keep the null counts (honest dash)
    // and still return the pure registry. Log server-side; never fail the whole
    // endpoint just because a landing-page count could not be read.
    console.error('[agent-ops/registry] live counts unavailable:', isPgrestTimeout(err) ? 'timeout' : err)
  }

  return NextResponse.json({
    registryHash: REGISTRY_HASH,
    runtimes,
    tools,
    counts,
  })
}
