/**
 * Unit tests for POST /api/runtime-telemetry/consumer
 * (src/app/api/runtime-telemetry/consumer/route.ts) and the installation auth
 * it depends on.
 *
 * Pure, offline: pgrest is mocked — no network, no gpu1 backend, no secrets.
 * Covers per-installation auth, the fail-closed refusals, mandatory
 * identifiers, every event type, the 16 KB cap, secret-pattern rejection, and
 * the no-echo guarantee.
 */
import { createHash } from 'node:crypto'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_TOKEN = 'consumer-installation-token-fixture-value'
const VALID_TOKEN_HASH = createHash('sha256').update(VALID_TOKEN, 'utf8').digest('hex')

interface InstallRow {
  id: string
  project_id: string | null
  copilot_id: string
  environment: string
  label: string | null
  status: string
  token_hash: string
  last_seen_at: string | null
  last_version_loaded: string | null
  last_version_loaded_at: string | null
  version_id: string | null
  delivery_event_id: string | null
}

const activeInstallation: InstallRow = {
  id: 'inst-1',
  project_id: 'proj-1',
  copilot_id: 'cop-1',
  environment: 'production',
  label: 'acme-prod',
  status: 'active',
  token_hash: VALID_TOKEN_HASH,
  last_seen_at: null,
  last_version_loaded: null,
  last_version_loaded_at: null,
  version_id: 'v-3',
  delivery_event_id: 'delivery-1',
}

/** Rows the mocked backend will match token_hash lookups against. */
let installationRows: InstallRow[] = [activeInstallation]
let insertedRows: Record<string, unknown>[] = []
let patchedRows: { path: string; body: unknown }[] = []
let insertBehaviour: (() => void) | null = null
let deliveryById: Record<string, { id: string; projectId: string | null; copilotId: string; versionId: string | null; status: string }> = {
  'delivery-1': { id: 'delivery-1', projectId: 'proj-1', copilotId: 'cop-1', versionId: 'v-3', status: 'delivered' },
}

vi.mock('@/lib/agent-mission-control/postgrest', () => ({
  pgrest: vi.fn(async (method: string, path: string, body?: unknown) => {
    if (method === 'GET' && path.startsWith('consumer_installations')) {
      const match = /token_hash=eq\.([0-9a-f]+)/.exec(path)
      const hash = match?.[1] ?? ''
      return installationRows.filter((row) => row.token_hash === hash)
    }
    if (method === 'POST' && path === 'runtime_telemetry_events') {
      if (insertBehaviour) insertBehaviour()
      insertedRows.push(body as Record<string, unknown>)
      return [body]
    }
    if (method === 'PATCH' && path.startsWith('consumer_installations')) {
      patchedRows.push({ path, body })
      return [body]
    }
    return []
  }),
  isPgrestTimeout: () => false,
}))

vi.mock('@/lib/agent-mission-control/delivery-events-store', () => ({
  getDeliveryEventById: vi.fn(async (id: string) => deliveryById[id] ?? null),
}))

import { POST } from '@/app/api/runtime-telemetry/consumer/route'

function req(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/runtime-telemetry/consumer', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

function auth(token = VALID_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` }
}

const validEvent = {
  eventId: 'cevt_1',
  eventType: 'consumer.run_completed' as const,
  projectId: 'proj-1',
  copilotId: 'cop-1',
  versionId: 'v-3',
  runId: 'run-1',
  installationId: 'inst-1',
  environment: 'production' as const,
  // Relative to now: the route rejects claims far in the past, so a hard-coded
  // date would start failing once the calendar passed it.
  timestamp: new Date(Date.now() - 60_000).toISOString(),
}

describe('POST /api/runtime-telemetry/consumer', () => {
  beforeEach(() => {
    installationRows = [{ ...activeInstallation }]
    insertedRows = []
    patchedRows = []
    insertBehaviour = null
    deliveryById = {
      'delivery-1': { id: 'delivery-1', projectId: 'proj-1', copilotId: 'cop-1', versionId: 'v-3', status: 'delivered' },
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── Authentication ────────────────────────────────────────────────────────

  it('1 — authenticated event is ingested -> 202, row carries installation_id', async () => {
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(202)
    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0].installation_id).toBe('inst-1')
    expect(insertedRows[0].event_type).toBe('consumer.run_completed')
    // The provenance marker the classifier already recognises.
    expect((insertedRows[0].environment as Record<string, unknown>).source).toBe('consumer')
  })

  it('2 — NO token -> 401, nothing ingested', async () => {
    const res = await POST(req(validEvent))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('3 — wrong token -> 401, nothing ingested', async () => {
    const res = await POST(req(validEvent, auth('a-completely-different-token-value')))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('4 — UNKNOWN installation is refused and NEVER created on the fly', async () => {
    installationRows = []
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
    // No installation row was invented from an anonymous POST.
    expect(patchedRows).toHaveLength(0)
  })

  it('5 — REVOKED installation -> 401', async () => {
    installationRows = [{ ...activeInstallation, status: 'revoked' }]
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('6 — valid token cannot report as a DIFFERENT installationId', async () => {
    const res = await POST(req({ ...validEvent, installationId: 'inst-other' }, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it("7 — installation cannot report for another copilot", async () => {
    const res = await POST(req({ ...validEvent, copilotId: 'cop-other' }, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('8 — a staging token cannot report production activity', async () => {
    installationRows = [{ ...activeInstallation, environment: 'staging' }]
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  // ── Event vocabulary ──────────────────────────────────────────────────────

  const allEventTypes = [
    'consumer.installation_seen',
    'consumer.version_loaded',
    'consumer.run_started',
    'consumer.run_completed',
    'consumer.run_failed',
    'consumer.heartbeat',
  ] as const

  for (const eventType of allEventTypes) {
    it(`9 — accepts event type ${eventType}`, async () => {
      const res = await POST(req({ ...validEvent, eventType, eventId: `cevt_${eventType}` }, auth()))
      expect(res.status).toBe(202)
      expect(insertedRows[0].event_type).toBe(eventType)
    })
  }

  it('10 — rejects an unknown event type -> 400', async () => {
    const res = await POST(req({ ...validEvent, eventType: 'consumer.exfiltrate' }, auth()))
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('11 — version_loaded records the loaded version on the installation', async () => {
    const res = await POST(
      req({ ...validEvent, eventType: 'consumer.version_loaded', versionId: 'v-3' }, auth())
    )
    expect(res.status).toBe(202)
    expect(patchedRows).toHaveLength(1)
    expect((patchedRows[0].body as Record<string, unknown>).last_version_loaded).toBe('v-3')
  })

  // ── Mandatory identifiers ─────────────────────────────────────────────────

  for (const field of [
    'eventId',
    'projectId',
    'copilotId',
    'versionId',
    'runId',
    'installationId',
    'environment',
    'timestamp',
  ] as const) {
    it(`12 — missing mandatory identifier "${field}" -> 400`, async () => {
      const body: Record<string, unknown> = { ...validEvent }
      delete body[field]
      const res = await POST(req(body, auth()))
      expect(res.status).toBe(400)
      expect(insertedRows).toHaveLength(0)
    })
  }

  it('13 — unknown extra field is rejected (strict schema) -> 400', async () => {
    const res = await POST(req({ ...validEvent, smuggled: 'x' }, auth()))
    expect(res.status).toBe(400)
  })

  it('14 — invalid environment value -> 400', async () => {
    const res = await POST(req({ ...validEvent, environment: 'prod' }, auth()))
    expect(res.status).toBe(400)
  })

  // ── Hostile payload ───────────────────────────────────────────────────────

  it('15 — payload over 16 KB -> 413, before any auth or parse work', async () => {
    const huge = { ...validEvent, runId: 'r'.repeat(20 * 1024) }
    const res = await POST(req(huge, auth()))
    expect(res.status).toBe(413)
    expect(insertedRows).toHaveLength(0)
  })

  it('16 — invalid JSON -> 400', async () => {
    const res = await POST(req('{not json', auth()))
    expect(res.status).toBe(400)
  })

  for (const [label, value] of [
    ['openai-style key', 'sk-abcdefghijklmnop'],
    ['github token', 'ghp_abcdefghijklmnop'],
    ['jwt', 'eyJhbGciOiJIUzI1NiJ9'],
    ['pem block', '-----BEGIN PRIVATE KEY-----'],
    ['bearer dump', 'Authorization: Bearer abcdefghijklmnopqr'],
  ] as const) {
    it(`17 — secret pattern in payload (${label}) -> 400, not ingested`, async () => {
      const res = await POST(req({ ...validEvent, runId: value }, auth()))
      expect(res.status).toBe(400)
      expect(insertedRows).toHaveLength(0)
    })
  }

  // ── No echo ───────────────────────────────────────────────────────────────

  it('18 — a 401 body echoes nothing: no token, no field, no reason', async () => {
    const res = await POST(req({ ...validEvent, installationId: 'inst-other' }, auth()))
    const text = await res.text()
    expect(text).not.toContain(VALID_TOKEN)
    expect(text).not.toContain('inst-other')
    expect(text).not.toContain('token_hash')
    expect(JSON.parse(text)).toEqual({ error: 'unauthorized' })
  })

  it('19 — a 400 body never names the offending field', async () => {
    const res = await POST(req({ ...validEvent, eventType: 'consumer.exfiltrate' }, auth()))
    const text = await res.text()
    expect(text).not.toContain('eventType')
    expect(text).not.toContain('consumer.exfiltrate')
  })

  it('20 — an insert failure leaks no upstream detail', async () => {
    insertBehaviour = () => {
      throw new Error('relation "runtime_telemetry_events" column secret_col does not exist')
    }
    const res = await POST(req(validEvent, auth()))
    const text = await res.text()
    expect(res.status).toBe(500)
    expect(text).not.toContain('secret_col')
    expect(text).not.toContain('relation')
    expect(JSON.parse(text)).toEqual({ error: 'internal error' })
  })

  it('21 — duplicate event id is idempotent -> 202 deduplicated', async () => {
    insertBehaviour = () => {
      throw Object.assign(new Error('duplicate key value violates unique constraint'), { status: 409 })
    }
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(202)
    expect((await res.json()).deduplicated).toBe(true)
  })

  it('22 — the token value is never written into the telemetry row', async () => {
    await POST(req(validEvent, auth()))
    expect(JSON.stringify(insertedRows[0])).not.toContain(VALID_TOKEN)
    expect(JSON.stringify(insertedRows[0])).not.toContain(VALID_TOKEN_HASH)
  })

  // ── HAUT-1 — cross-tenant project writes ──────────────────────────────────

  it('23 — a valid installation CANNOT report for another project -> 401', async () => {
    const res = await POST(req({ ...validEvent, projectId: 'SOMEONE-ELSES-PROJECT' }, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('24 — an installation with NO provisioned project reports nothing -> 401', async () => {
    // Fail-closed: a null project_id is "unprovisioned", never a wildcard.
    installationRows = [{ ...activeInstallation, project_id: null }]
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('25 — the stored project_id comes from the INSTALLATION, matching the claim', async () => {
    await POST(req(validEvent, auth()))
    expect(insertedRows[0].project_id).toBe('proj-1')
  })

  // ── HAUT-2 — attacker-controlled time ─────────────────────────────────────

  it('26 — a timestamp far in the FUTURE is rejected -> 400', async () => {
    const res = await POST(req({ ...validEvent, timestamp: '2999-01-01T00:00:00.000Z' }, auth()))
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('27 — a non-date timestamp is rejected -> 400', async () => {
    const res = await POST(req({ ...validEvent, timestamp: 'hello-not-a-date' }, auth()))
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('28 — a timestamp far in the PAST is rejected -> 400', async () => {
    const old = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000).toISOString()
    const res = await POST(req({ ...validEvent, timestamp: old }, auth()))
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })

  it('29 — received_at is the SERVER clock, never the claimed timestamp', async () => {
    const before = Date.now()
    const claimed = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    await POST(req({ ...validEvent, timestamp: claimed }, auth()))
    const after = Date.now()

    const receivedAt = String(insertedRows[0].received_at)
    // Not the caller's value...
    expect(receivedAt).not.toBe(claimed)
    // ...but a server instant taken during this request.
    const receivedMs = Date.parse(receivedAt)
    expect(receivedMs).toBeGreaterThanOrEqual(before)
    expect(receivedMs).toBeLessThanOrEqual(after)
    // The claim is preserved, but in a column nothing depends on.
    expect(insertedRows[0].reported_at).toBe(claimed)
  })

  it('30 — last_seen_at is the server clock too, not the claimed time', async () => {
    const claimed = new Date(Date.now() - 3 * 60 * 1000).toISOString()
    await POST(req({ ...validEvent, eventType: 'consumer.version_loaded', timestamp: claimed }, auth()))
    expect((patchedRows[0].body as Record<string, unknown>).last_seen_at).not.toBe(claimed)
  })

  // ── HAUT-3 — eventId squatting a shared primary key ───────────────────────

  it('31 — the stored row id is NAMESPACED by installation, not caller-chosen', async () => {
    await POST(req({ ...validEvent, eventId: 'internal-run-event-42' }, auth()))
    // The caller cannot land on an internal emitter's primary key.
    expect(insertedRows[0].id).not.toBe('internal-run-event-42')
    expect(insertedRows[0].id).toBe('consumer:inst-1:internal-run-event-42')
  })

  it('32 — two installations reusing the SAME eventId do not collide', async () => {
    const otherToken = 'second-installation-token-fixture-value'
    installationRows = [
      { ...activeInstallation },
      {
        ...activeInstallation,
        id: 'inst-2',
        label: 'acme-two',
        token_hash: createHash('sha256').update(otherToken, 'utf8').digest('hex'),
      },
    ]

    await POST(req({ ...validEvent, eventId: 'shared-id' }, auth()))
    await POST(
      req({ ...validEvent, eventId: 'shared-id', installationId: 'inst-2' }, auth(otherToken))
    )

    expect(insertedRows).toHaveLength(2)
    expect(insertedRows[0].id).not.toBe(insertedRows[1].id)
  })

  it('33 — idempotency still holds WITHIN one installation namespace', async () => {
    await POST(req({ ...validEvent, eventId: 'same-event' }, auth()))
    const firstId = insertedRows[0].id
    insertedRows = []
    await POST(req({ ...validEvent, eventId: 'same-event' }, auth()))
    // Same caller + same eventId => same primary key, so the database dedups.
    expect(insertedRows[0].id).toBe(firstId)
  })

  // ── MOYEN-4 — unverified versionId ────────────────────────────────────────

  it('34 — a never-shipped versionId is rejected', async () => {
    const res = await POST(req({ ...validEvent, versionId: 'v-NEVER-SHIPPED' }, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  it('34b — mismatched delivery event version is rejected', async () => {
    deliveryById['delivery-1'] = {
      id: 'delivery-1',
      projectId: 'proj-1',
      copilotId: 'cop-1',
      versionId: 'v-else',
      status: 'delivered',
    }
    const res = await POST(req(validEvent, auth()))
    expect(res.status).toBe(401)
    expect(insertedRows).toHaveLength(0)
  })

  // ── MOYEN-5 — the secret scan must see the RAW payload ────────────────────

  it('35 — a secret in an UNDECLARED field is caught (raw scan, pre-Zod)', async () => {
    // .strict() would have stripped this key before a post-parse scanner ran,
    // which is exactly why the scan moved ahead of the parse.
    const res = await POST(req({ ...validEvent, leaked: 'sk-abcdefghijklmnopqrst' }, auth()))
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('suspicious content')
    expect(insertedRows).toHaveLength(0)
  })

  it('36 — a secret in a nested undeclared field is caught on the raw body', async () => {
    const res = await POST(
      req({ ...validEvent, meta: { nested: { key: 'ghp_abcdefghijklmnop' } } }, auth())
    )
    expect(res.status).toBe(400)
    expect(await res.text()).toContain('suspicious content')
    expect(insertedRows).toHaveLength(0)
  })

  it('37 — the raw scan runs BEFORE auth: no token still rejects the secret', async () => {
    const res = await POST(req({ ...validEvent, leaked: 'sk-abcdefghijklmnopqrst' }))
    expect(res.status).toBe(400)
    expect(insertedRows).toHaveLength(0)
  })
})
