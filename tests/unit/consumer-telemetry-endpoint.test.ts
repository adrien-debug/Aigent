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
  copilot_id: string
  environment: string
  label: string | null
  status: string
  token_hash: string
  last_seen_at: string | null
  last_version_loaded: string | null
  last_version_loaded_at: string | null
}

const activeInstallation: InstallRow = {
  id: 'inst-1',
  copilot_id: 'cop-1',
  environment: 'production',
  label: 'acme-prod',
  status: 'active',
  token_hash: VALID_TOKEN_HASH,
  last_seen_at: null,
  last_version_loaded: null,
  last_version_loaded_at: null,
}

/** Rows the mocked backend will match token_hash lookups against. */
let installationRows: InstallRow[] = [activeInstallation]
let insertedRows: Record<string, unknown>[] = []
let patchedRows: { path: string; body: unknown }[] = []
let insertBehaviour: (() => void) | null = null

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
  timestamp: '2026-07-31T10:00:00.000Z',
}

describe('POST /api/runtime-telemetry/consumer', () => {
  beforeEach(() => {
    installationRows = [{ ...activeInstallation }]
    insertedRows = []
    patchedRows = []
    insertBehaviour = null
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
      req({ ...validEvent, eventType: 'consumer.version_loaded', versionId: 'v-9' }, auth())
    )
    expect(res.status).toBe(202)
    expect(patchedRows).toHaveLength(1)
    expect((patchedRows[0].body as Record<string, unknown>).last_version_loaded).toBe('v-9')
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
})
