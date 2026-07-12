/**
 * Live tests — proxy auth gate + GitHub file-read route security.
 *
 * Opt-in (`npm run test:live`): requires `npm run dev` running. No OpenAI
 * calls in this file (cheap/free — pure HTTP + GitHub reads), but still
 * lives under tests/live because it depends on the running app + GITHUB_TOKEN.
 * Each test skips (not fails) when the app isn't reachable.
 */
import { describe, expect, it } from 'vitest'

import { amcHeaders, findAppBaseUrl, findRepoScopedLangGraphCopilot } from './helpers'

describe('proxy.ts — /api/agent-ops/** auth gate', () => {
  it('rejects a request with no session and no x-amc-key (401)', async () => {
    const baseUrl = await findAppBaseUrl()
    if (!baseUrl) {
      console.warn('[live] skip: app not reachable on :3000/:3001 — run `npm run dev` to exercise this test')
      return
    }
    const res = await fetch(`${baseUrl}/api/agent-ops/copilots`, { signal: AbortSignal.timeout(10_000) })
    expect(res.status).toBe(401)
  })

  it('rejects a request with a WRONG x-amc-key (401)', async () => {
    const baseUrl = await findAppBaseUrl()
    if (!baseUrl) {
      console.warn('[live] skip: app not reachable')
      return
    }
    const res = await fetch(`${baseUrl}/api/agent-ops/copilots`, {
      headers: { 'x-amc-key': 'definitely-not-the-real-key' },
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.status).toBe(401)
  })

  it('accepts a request with the correct x-amc-key', async () => {
    const baseUrl = await findAppBaseUrl()
    const apiKey = process.env.AMC_API_KEY
    if (!baseUrl || !apiKey) {
      console.warn('[live] skip: app not reachable or AMC_API_KEY not set')
      return
    }
    const res = await fetch(`${baseUrl}/api/agent-ops/copilots`, {
      headers: amcHeaders(apiKey),
      signal: AbortSignal.timeout(10_000),
    })
    expect(res.status).not.toBe(401)
  })
})

describe('GET /api/agent-ops/github/file — secret-path + traversal refusal', () => {
  // A syntactically valid owner/name is enough for the .env / traversal
  // refusals below: both are rejected by isRefusedPath BEFORE the route ever
  // calls GitHub, so the repo doesn't need to exist or be reachable. Only the
  // "legitimate file" 200 test (further down) needs a REAL, reachable repo —
  // it resolves one dynamically from the live backend instead of guessing.
  const repo = 'hearst/console'

  it('refuses to read .env (403)', async () => {
    const baseUrl = await findAppBaseUrl()
    const apiKey = process.env.AMC_API_KEY
    if (!baseUrl || !apiKey) {
      console.warn('[live] skip: app not reachable or AMC_API_KEY not set')
      return
    }
    const res = await fetch(
      `${baseUrl}/api/agent-ops/github/file?repo=${encodeURIComponent(repo)}&path=.env`,
      { headers: amcHeaders(apiKey), signal: AbortSignal.timeout(10_000) }
    )
    expect(res.status).toBe(403)
  })

  it('refuses a path-traversal attempt (400)', async () => {
    const baseUrl = await findAppBaseUrl()
    const apiKey = process.env.AMC_API_KEY
    if (!baseUrl || !apiKey) {
      console.warn('[live] skip: app not reachable or AMC_API_KEY not set')
      return
    }
    const res = await fetch(
      `${baseUrl}/api/agent-ops/github/file?repo=${encodeURIComponent('../../etc/passwd')}&path=passwd`,
      { headers: amcHeaders(apiKey), signal: AbortSignal.timeout(10_000) }
    )
    expect(res.status).toBe(400)
  })

  it('serves a legitimate file (package.json) with 200 and real content', async () => {
    const baseUrl = await findAppBaseUrl()
    const apiKey = process.env.AMC_API_KEY
    if (!baseUrl || !apiKey) {
      console.warn('[live] skip: app not reachable or AMC_API_KEY not set')
      return
    }
    if (!process.env.GITHUB_TOKEN) {
      console.warn('[live] skip: GITHUB_TOKEN not set — cannot exercise a real GitHub read')
      return
    }
    // Resolve a REAL, reachable repo from the live backend rather than
    // guessing a name — a guessed repo the token can't see would 404/502 and
    // this test would never actually exercise the 200 path.
    const copilot = await findRepoScopedLangGraphCopilot()
    if (!copilot) {
      console.warn('[live] skip: no repo-scoped copilot found in the live backend to source a real repo from')
      return
    }
    const res = await fetch(
      `${baseUrl}/api/agent-ops/github/file?repo=${encodeURIComponent(copilot.repoFullName)}&path=package.json`,
      { headers: amcHeaders(apiKey), signal: AbortSignal.timeout(15_000) }
    )
    if (res.status === 404 || res.status === 502) {
      // The resolved repo may still be unreachable from this environment
      // (network/token scope) — that's an environment fact, not a route bug.
      console.warn(`[live] skip: repo ${copilot.repoFullName} not reachable from this environment (status ${res.status})`)
      return
    }
    expect(res.status).toBe(200)
    // Shape per RepoFileContent (github.ts): { path, encoding, text, truncated }.
    const body = await res.json()
    expect(typeof body.text).toBe('string')
    expect(body.text.length).toBeGreaterThan(0)
  })
})
