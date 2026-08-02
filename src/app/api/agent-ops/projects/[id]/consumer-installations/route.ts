import { randomUUID } from 'node:crypto'

import { NextResponse } from 'next/server'
import { z } from 'zod'

import {
  createConsumerInstallation,
  listConsumerInstallations,
} from '@/lib/agent-mission-control/consumer-installations'
import { getProject, getCopilot, getVersionsForCopilot } from '@/lib/agent-mission-control/data'
import { getDeliveryEventById } from '@/lib/agent-mission-control/delivery-events-store'
import { isPgrestTimeout } from '@/lib/agent-mission-control/postgrest'

const ID_RE = /^[a-z0-9-]{1,200}$/
const REF_ID_RE = /^[A-Za-z0-9._:-]{1,200}$/
const ENV_RE = z.enum(['production', 'staging', 'development'])

const createBodySchema = z
  .object({
    copilotId: z.string().regex(REF_ID_RE),
    versionId: z.string().regex(REF_ID_RE),
    deliveryEventId: z.string().regex(REF_ID_RE),
    environment: ENV_RE,
    label: z.string().trim().min(1).max(120).optional(),
  })
  .strict()

function installationId(environment: z.infer<typeof ENV_RE>) {
  return `inst-${environment}-${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const copilotId = new URL(request.url).searchParams.get('copilotId') ?? undefined
  if (copilotId && !ID_RE.test(copilotId)) return NextResponse.json({ error: 'invalid copilotId' }, { status: 400 })

  try {
    const project = await getProject(id)
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    const installations = await listConsumerInstallations(id, copilotId)
    return NextResponse.json({ ok: true, projectId: id, installations })
  } catch (err) {
    console.error('[consumer-installations] list failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!ID_RE.test(id)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })

  let body: z.infer<typeof createBodySchema>
  try {
    const parsed = createBodySchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'invalid payload' }, { status: 400 })
    body = parsed.data
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  try {
    const [project, copilot, versions, delivery] = await Promise.all([
      getProject(id),
      getCopilot(body.copilotId),
      getVersionsForCopilot(body.copilotId),
      getDeliveryEventById(body.deliveryEventId),
    ])
    if (!project) return NextResponse.json({ error: 'project not found' }, { status: 404 })
    if (!copilot) return NextResponse.json({ error: 'copilot not found' }, { status: 404 })
    if (copilot.projectId !== id) {
      return NextResponse.json({ error: 'copilot does not belong to project' }, { status: 422 })
    }
    if (!versions.some((v) => v.id === body.versionId)) {
      return NextResponse.json({ error: 'version not found for copilot' }, { status: 422 })
    }
    if (!delivery) return NextResponse.json({ error: 'delivery event not found' }, { status: 404 })
    if (
      delivery.copilotId !== body.copilotId ||
      delivery.projectId !== id ||
      delivery.versionId !== body.versionId ||
      delivery.status !== 'delivered'
    ) {
      return NextResponse.json({ error: 'delivery event does not match project/copilot/version' }, { status: 422 })
    }

    const idGenerated = installationId(body.environment)
    const created = await createConsumerInstallation({
      id: idGenerated,
      projectId: id,
      copilotId: body.copilotId,
      versionId: body.versionId,
      deliveryEventId: body.deliveryEventId,
      environment: body.environment,
      label: body.label ?? null,
    })
    return NextResponse.json(
      {
        ok: true,
        installationId: created.installationId,
        token: created.token,
        tokenPrefix: created.tokenPrefix,
        projectId: id,
        copilotId: body.copilotId,
        versionId: body.versionId,
        deliveryEventId: body.deliveryEventId,
      },
      { status: 201 }
    )
  } catch (err) {
    console.error('[consumer-installations] create failed', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'internal error' }, { status: isPgrestTimeout(err) ? 504 : 502 })
  }
}
