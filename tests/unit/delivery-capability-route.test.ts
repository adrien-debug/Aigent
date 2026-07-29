/**
 * `GET /api/agent-ops/delivery-capability` — the server-side answer to "can a
 * real GitHub delivery happen here?", asked BEFORE the action.
 *
 * The console cannot read `GITHUB_PUSH_ENABLED`, `GITHUB_TOKEN` or the backend
 * vars, so before this route the real-delivery button armed itself only after
 * a push had already returned `dryRun:false` — you had to deliver for real
 * before the button that delivers for real became clickable.
 *
 * Two things are pinned here: the boolean matches `push-agent/route.ts`'s own
 * three preconditions exactly (drift there without drifting here and the UI
 * offers a button that silently downgrades to a dry-run), and the body carries
 * nothing but that boolean — no value, no variable name, no per-precondition
 * breakdown that would tell a caller which secret to go set.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { GET } from '@/app/api/agent-ops/delivery-capability/route'

const ENV_KEYS = [
  'AMC_DATA_SOURCE',
  'AMC_SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'GITHUB_TOKEN',
  'GITHUB_PUSH_ENABLED',
] as const

const SECRET_TOKEN = 'ghp_thisIsASecretTokenValue0000000000'

let saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

/** Every precondition satisfied — the only shape that may answer `true`. */
function armEverything() {
  process.env.AMC_DATA_SOURCE = 'gpu1'
  process.env.AMC_SUPABASE_URL = 'https://gpu1.example.invalid'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-value'
  process.env.GITHUB_TOKEN = SECRET_TOKEN
  process.env.GITHUB_PUSH_ENABLED = '1'
}

async function readBody(): Promise<{ status: number; body: unknown; raw: string }> {
  const res = await GET()
  const raw = await res.clone().text()
  return { status: res.status, body: await res.json(), raw }
}

describe('GET /api/agent-ops/delivery-capability', () => {
  beforeEach(() => {
    saved = {}
    for (const k of ENV_KEYS) saved[k] = process.env[k]
  })

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('1 — every precondition present → true', async () => {
    armEverything()
    const { status, body } = await readBody()
    expect(status).toBe(200)
    expect(body).toEqual({ realDeliveryEnabled: true })
  })

  it('2 — push flag absent → false', async () => {
    armEverything()
    delete process.env.GITHUB_PUSH_ENABLED
    expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })
  })

  it('2b — push flag set to something other than "1" → false, never truthy-coerced', async () => {
    armEverything()
    for (const value of ['true', 'yes', '0', 'on', ' 1']) {
      process.env.GITHUB_PUSH_ENABLED = value
      expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })
    }
  })

  it('3 — GitHub token absent → false', async () => {
    armEverything()
    delete process.env.GITHUB_TOKEN
    expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })
  })

  it('4 — live backend not configured → false', async () => {
    // Each of the three backend preconditions independently disqualifies.
    armEverything()
    process.env.AMC_DATA_SOURCE = 'mock'
    expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })

    armEverything()
    delete process.env.AMC_SUPABASE_URL
    expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })

    armEverything()
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await readBody().then((r) => r.body)).toEqual({ realDeliveryEnabled: false })
  })

  it('5 — the response carries the boolean and NOTHING else', async () => {
    armEverything()
    const { body } = await readBody()
    // Exactly one key: no breakdown of which precondition failed, which would
    // read as a checklist of which secret to go set.
    expect(Object.keys(body as object)).toEqual(['realDeliveryEnabled'])
  })

  it('6 — no secret VALUE and no variable NAME ever appears in the payload', async () => {
    armEverything()
    const { raw } = await readBody()
    expect(raw).not.toContain(SECRET_TOKEN)
    expect(raw).not.toContain('service-role-key-value')
    expect(raw).not.toContain('gpu1.example.invalid')
    for (const name of ENV_KEYS) expect(raw).not.toContain(name)

    // Also true on the refusing path — a `false` must not explain itself.
    delete process.env.GITHUB_TOKEN
    const denied = await readBody()
    expect(denied.raw).not.toContain(SECRET_TOKEN)
    for (const name of ENV_KEYS) expect(denied.raw).not.toContain(name)
  })

  it('7 — auth is upstream: the handler itself is a pure read, no session logic', async () => {
    // `/api/agent-ops/**` is gated by src/proxy.ts (matcher covers the whole
    // prefix), the same convention as agent-ops/agents/route.ts. This asserts
    // the handler adds no second, driftable gate: it answers identically with
    // no request object at all, because it never inspects one.
    armEverything()
    const res = await GET()
    expect(res.status).toBe(200)
  })
})
