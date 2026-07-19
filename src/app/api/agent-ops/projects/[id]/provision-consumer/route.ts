import { NextResponse } from 'next/server'
import { z } from 'zod'

import { getProject } from '@/lib/agent-mission-control/data'
import {
  getConsumerProvisionStatus,
  provisionConsumerIntake,
  type PushAgentDeliveryMode,
} from '@/lib/agent-mission-control/github'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

const PROJECT_ID_RE = /^[a-z0-9-]{1,200}$/

const bodySchema = z
  .object({
    confirm: z.boolean().optional(),
    force: z.boolean().optional(),
    deliveryMode: z.enum(['pull_request', 'direct_commit']).optional(),
  })
  .strip()

function isUpstreamTimeout(err: unknown): boolean {
  if (isPgrestTimeout(err)) return true
  if (!(err instanceof Error)) return false
  return /^GitHub request timed out after \d+ms/.test(err.message)
}

/**
 * GET — consumer intake provision status (reads aigent/consumer-ready.json).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (!project.repoFullName) {
    return NextResponse.json({ error: 'project has no linked GitHub repo' }, { status: 422 })
  }

  try {
    const status = await getConsumerProvisionStatus(project.repoFullName)
    return NextResponse.json({ ok: true, projectId: id, repoFullName: project.repoFullName, ...status })
  } catch (err) {
    console.error('[provision-consumer] status failed:', err)
    if (isUpstreamTimeout(err)) {
      return NextResponse.json({ error: 'GitHub request timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: 'could not read consumer status from GitHub' }, { status: 502 })
  }
}

/**
 * POST — provision the standard consumer intake pack (PR by default, dry-run unless confirm).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!PROJECT_ID_RE.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const project = await getProject(id)
  if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
  if (!project.repoFullName) {
    return NextResponse.json({ error: 'project has no linked GitHub repo' }, { status: 422 })
  }

  let confirm = false
  let force = false
  let deliveryMode: PushAgentDeliveryMode = 'pull_request'
  try {
    const raw = await request.json().catch(() => ({}))
    const parsed = bodySchema.safeParse(raw)
    if (parsed.success) {
      confirm = parsed.data.confirm === true
      force = parsed.data.force === true
      deliveryMode = parsed.data.deliveryMode ?? 'pull_request'
    }
  } catch {
    // empty body → dry-run defaults
  }

  try {
    const result = await provisionConsumerIntake({
      project,
      dryRun: !confirm,
      mode: deliveryMode,
      force,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[provision-consumer] provision failed:', err)
    const message = err instanceof Error ? err.message : String(err)
    if (/GitHub not configured/.test(message)) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    if (/branch_exists/.test(message)) {
      return NextResponse.json({ error: message }, { status: 409 })
    }
    if (isUpstreamTimeout(err)) {
      return NextResponse.json({ error: 'GitHub request timed out' }, { status: 504 })
    }
    return NextResponse.json({ error: 'consumer provision failed' }, { status: 502 })
  }
}
