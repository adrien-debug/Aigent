import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  getConsumerInstallation,
  revokeConsumerInstallation,
} from '@/lib/agent-mission-control/consumer-installations'
import { getProject } from '@/lib/agent-mission-control/data'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

const ID_RE = /^[a-z0-9-]{1,200}$/
const bodySchema = z
  .object({
    reason: z.string().trim().min(3).max(240),
  })
  .strict()

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; installationId: string }> }
) {
  const { id, installationId } = await params
  if (!ID_RE.test(id) || !ID_RE.test(installationId)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  let reason: string
  try {
    const parsed = bodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
    reason = parsed.data.reason
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const [project, installation] = await Promise.all([getProject(id), getConsumerInstallation(installationId)])
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    if (!installation || installation.projectId !== id) {
      return NextResponse.json({ error: 'installation not found' }, { status: 404 })
    }
    if (installation.status === 'revoked') {
      return NextResponse.json({ error: 'installation already revoked' }, { status: 409 })
    }
    const revoked = await revokeConsumerInstallation(installationId, reason)
    if (!revoked) return NextResponse.json({ error: 'installation not found' }, { status: 404 })
    return NextResponse.json({ ok: true, installation: revoked })
  } catch (err) {
    console.error(
      '[consumer-installations-revoke] revoke failed',
      err instanceof Error ? err.message : err
    )
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
