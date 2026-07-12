/**
 * Unit tests for isSecretPath (src/langgraph/tool-registry.mjs).
 *
 * isSecretPath is the last line of defense that stops the agent from reading
 * .env files, private keys, and other credential material via read_repo_file
 * / list_repo_tree / search_repo — even inside a repo the copilot is
 * otherwise fully scoped to. It is a security denylist, so it must be
 * exercised directly, not just implied by other tests.
 *
 * isSecretPath is not exported (internal to tool-registry.mjs), so these
 * tests drive it through buildTool('read_repo_file', scope).invoke(...),
 * which checks the path FIRST and returns a refusal WITHOUT ever calling
 * fetch — so no network/GITHUB_TOKEN is needed to observe the refusal. A
 * couple of accepted-path cases mock `fetch` to prove the tool does NOT
 * refuse legitimate files (the denylist isn't overly broad).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTool } from '@/langgraph/tool-registry.mjs'

const scope = { repoFullName: 'hearst/console' }

describe('isSecretPath (via read_repo_file) — refuses secret/credential paths', () => {
  const originalToken = process.env.GITHUB_TOKEN

  beforeEach(() => {
    // A token must be "present" for the tool to get past its own token guard
    // and reach the secret-path check (the check we're testing runs before
    // any network call regardless).
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken
  })

  const refusedPaths = [
    '.env',
    '.env.local',
    '.env.production',
    'config/.env',
    'key.pem',
    'certs/server.pem',
    'id_rsa',
    '.ssh/id_rsa',
    'id_ed25519',
    'secrets.yml',
    'secret.json',
    'my_secret.txt',
    'db-secret.yaml',
    'app.key',
    'credentials',
    'credentials.json',
    'bundle.pfx',
    'cert.p12',
  ]

  it.each(refusedPaths)('refuses "%s"', async (path) => {
    const tool = buildTool('read_repo_file', scope)
    const result = JSON.parse(await tool.invoke({ path }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/secret|credential/i)
  })
})

describe('isSecretPath (via read_repo_file) — accepts legitimate paths that merely LOOK similar', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const acceptedPaths = ['secretary.js', 'README.md', 'src/index.ts', 'package.json']

  it.each(acceptedPaths)('does not refuse "%s" on the secret-path check', async (path) => {
    // Mock fetch so the tool proceeds past the (passed) secret check to a
    // deterministic "file found" response — proving the refusal branch was
    // never taken (a refusal never calls fetch at all).
    const mockJson = {
      encoding: 'base64',
      content: Buffer.from('hello world').toString('base64'),
      path,
      size: 11,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    }) as unknown as typeof fetch

    const tool = buildTool('read_repo_file', scope)
    const result = JSON.parse(await tool.invoke({ path }))
    expect(result.ok).toBe(true)
    expect(result.content).toBe('hello world')
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('isSecretPath (via list_repo_tree) — filters secret entries out of directory listings', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
  })

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('drops .env and id_rsa from a tree listing but keeps README.md and secretary.js', async () => {
    const entries = [
      { name: '.env', type: 'file', path: '.env' },
      { name: 'id_rsa', type: 'file', path: '.ssh/id_rsa' },
      { name: 'README.md', type: 'file', path: 'README.md' },
      { name: 'secretary.js', type: 'file', path: 'src/secretary.js' },
    ]
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => entries,
    }) as unknown as typeof fetch

    const tool = buildTool('list_repo_tree', scope)
    const result = JSON.parse(await tool.invoke({ path: '' }))
    expect(result.ok).toBe(true)
    const names = result.entries.map((e: { name: string }) => e.name)
    expect(names).not.toContain('.env')
    expect(names).not.toContain('id_rsa')
    expect(names).toContain('README.md')
    expect(names).toContain('secretary.js')
  })
})
