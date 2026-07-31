import { NextResponse } from 'next/server'
import { z } from 'zod'

import { buildSkillTreeTrack } from '@/lib/agent-mission-control/agent-skills-export'
import { getCopilot, getManifestForCopilot } from '@/lib/agent-mission-control/data'
import {
  loadSkillTreeConnection,
  publishSkillTreeTrack,
  SkillTreeClientError,
} from '@/lib/agent-mission-control/skilltree-client'

const COPILOT_ID_RE = /^[a-z0-9-]{1,200}$/
const bodySchema = z.object({ confirm: z.literal(true) }).strict()

/**
 * Publish the current governed manifest's capabilities to SkillTree.
 *
 * The merge is non-destructive and every generated Skill stays private. This
 * route never accepts public visibility or delete flags; those require their
 * own explicit operator action in SkillTree.
 */
export async function POST(request: Request, { params }: { params: Promise<{ copilotId: string }> }) {
  const { copilotId } = await params
  if (!COPILOT_ID_RE.test(copilotId)) {
    return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })
  }

  const body = bodySchema.safeParse(await request.json().catch(() => null))
  if (!body.success) {
    return NextResponse.json({ error: 'confirm:true is required' }, { status: 400 })
  }

  try {
    const [copilot, manifest] = await Promise.all([
      getCopilot(copilotId),
      getManifestForCopilot(copilotId),
    ])
    if (!copilot) {
      return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    }
    if (!manifest) {
      return NextResponse.json({ error: 'copilot has no manifest' }, { status: 409 })
    }
    if (manifest.skills.length === 0) {
      return NextResponse.json({ error: 'copilot manifest has no skills to publish' }, { status: 422 })
    }

    const track = buildSkillTreeTrack({
      agentName: copilot.name,
      agentSlug: copilot.slug,
      agentDescription: copilot.description,
      manifestVersion: manifest.version,
      confirmationPolicy: manifest.confirmationPolicy,
      forbiddenActions: manifest.forbiddenActions,
      skills: manifest.skills,
    })
    const connection = await loadSkillTreeConnection()
    const result = await publishSkillTreeTrack(connection, track)

    return NextResponse.json({
      ok: true,
      treeName: result.treeName,
      slug: result.slug,
      track: track.name,
      skillCount: track.skills.length,
      added: result.added,
      updated: result.updated,
      deleted: result.deleted,
      visibility: 'private',
    })
  } catch (err) {
    if (err instanceof SkillTreeClientError) {
      console.error('[agent-ops/skilltree] publish failed', {
        copilotId,
        status: err.status,
        reason: err.message,
      })
      return NextResponse.json({ error: err.message }, { status: err.status })
    }

    console.error('[agent-ops/skilltree] publish failed', { copilotId })
    return NextResponse.json({ error: 'SkillTree publish failed' }, { status: 502 })
  }
}
