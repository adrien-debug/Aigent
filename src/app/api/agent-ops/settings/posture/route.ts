import { NextResponse } from 'next/server'

import { getSettingsPostureSnapshot } from '@/lib/agent-mission-control/settings-posture'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/**
 * GET /api/agent-ops/settings/posture
 *
 * Auth is enforced upstream by `src/proxy.ts` for every `/api/agent-ops/**`
 * route. This handler stays read-only and never returns secret values.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const snapshot = await getSettingsPostureSnapshot()
    return NextResponse.json(snapshot)
  } catch (err) {
    console.error('[agent-ops/settings/posture] snapshot failed:', err)
    return NextResponse.json({ error: 'settings posture unavailable' }, { status: 500 })
  }
}
