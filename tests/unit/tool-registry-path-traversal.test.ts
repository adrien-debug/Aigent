/**
 * Unit tests for the path-traversal guard in src/langgraph/tool-registry.mjs
 * (normalizeRepoPath).
 *
 * PROVEN, EXECUTED bug this guards against: normalizeRepoPath used to strip a
 * leading "./" or "/" but never rejected ".." segments. read_repo_file /
 * list_repo_tree then built the GitHub Contents API URL as
 * `https://api.github.com/repos/${repo}/contents/${cleanPath.split('/').map(encodeURIComponent).join('/')}`
 * — and encodeURIComponent('..') === '..', so percent-encoding never
 * neutralises a ".." segment. A path like
 * "../../../victim/private/contents/README.md" resolves the URL's path
 * component OUT of the intended repo segment and onto a DIFFERENT repo,
 * fetched with this server's own GITHUB_TOKEN:
 *
 *   new URL(
 *     'https://api.github.com/repos/owner/repo/contents/' +
 *       '../../../victim/private/contents/README.md'
 *   ).href
 *   // → 'https://api.github.com/repos/victim/private/contents/README.md'
 *
 * normalizeRepoPath is not exported (internal to tool-registry.mjs), so these
 * tests drive it through buildTool('read_repo_file'|'list_repo_tree', scope)
 * .invoke(...), which now refuses traversal BEFORE ever calling fetch — so no
 * network/GITHUB_TOKEN is needed to observe the refusal, and a mocked fetch
 * proves legitimate paths are unaffected.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildTool } from '@/langgraph/tool-registry.mjs'

const scope = { repoFullName: 'hearst/console' }

function expectNoGitHubFetch(): void {
  const calls = vi.mocked(global.fetch).mock.calls
  expect(calls.some(([input]) => String(input).startsWith('https://api.github.com/'))).toBe(false)
}

describe('normalizeRepoPath (via read_repo_file / list_repo_tree) — refuses traversal', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
    // Traversal must be refused BEFORE any network call — if fetch is ever
    // reached for a traversal path, that's the bug, so fail loudly rather
    // than silently succeeding against a mocked response.
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch should never be called for a rejected traversal path')
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  const traversalPaths = [
    '..',
    '../',
    '../secret.txt',
    'a/../../b',
    'a/../../../etc/passwd',
    '../../../victim/private/contents/README.md',
    './../etc/passwd',
    'foo/../../bar',
    // Percent-encoded forms — encodeURIComponent('..') === '..' so naive
    // percent-decoding alone doesn't help; these must ALSO be refused.
    '%2e%2e/secret.txt',
    '..%2f..%2fsecret.txt',
    '.%2e/secret.txt',
    // Double-encoded form.
    '%252e%252e/secret.txt',
    // Backslash variant some path parsers normalise as a separator.
    '..\\..\\secret.txt',
  ]

  it.each(traversalPaths)('read_repo_file refuses "%s"', async (path) => {
    const tool = buildTool('read_repo_file', scope)
    const result = JSON.parse(await tool.invoke({ path }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/traversal|invalid path/i)
    expectNoGitHubFetch()
  })

  it.each(traversalPaths)('list_repo_tree refuses "%s"', async (path) => {
    const tool = buildTool('list_repo_tree', scope)
    const result = JSON.parse(await tool.invoke({ path }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/traversal|invalid path/i)
    expectNoGitHubFetch()
  })

  it('documents the historical exploit shape a rejected path can no longer reach', async () => {
    // Direct proof: constructing the exact URL the tool used to build from an
    // unrejected traversal path resolves OUTSIDE the intended repo. This is
    // why refusal must happen before the URL is ever built — percent-encoding
    // does not neutralise "..". The tool-invocation tests above prove the
    // SAME path is now refused before reaching this URL construction at all.
    const maliciousPath = '../../../victim/private/contents/README.md'
    const exploitUrl = new URL(
      `https://api.github.com/repos/hearst/console/contents/${maliciousPath}`
    ).href
    expect(exploitUrl).toBe('https://api.github.com/repos/victim/private/contents/README.md')

    const tool = buildTool('read_repo_file', scope)
    const result = JSON.parse(await tool.invoke({ path: maliciousPath }))
    expect(result.ok).toBe(false)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})

describe('normalizeRepoPath (via read_repo_file) — accepts legitimate paths', () => {
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

  const legitimatePaths = [
    '',
    '.',
    '/',
    './',
    'README.md',
    'src/index.ts',
    './src/index.ts',
    '/src/index.ts',
    'a/b/c.txt',
    // Contains dots, but never a bare ".." segment — must NOT be refused.
    'v1.2.3/notes.md',
    'my..file.txt',
  ]

  it.each(legitimatePaths)('does not refuse "%s"', async (path) => {
    const mockJson = {
      encoding: 'base64',
      content: Buffer.from('hello world').toString('base64'),
      path: path || '',
      size: 11,
    }
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => mockJson,
    }) as unknown as typeof fetch

    const tool = buildTool('read_repo_file', scope)
    const result = JSON.parse(await tool.invoke({ path }))
    expect(result.ok).toBe(true)
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })
})

describe('list_repo_tree — refuses a REQUESTED secret-looking path, not just returned entries', () => {
  const originalToken = process.env.GITHUB_TOKEN
  const originalFetch = global.fetch

  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
    global.fetch = vi.fn().mockRejectedValue(
      new Error('fetch should never be called when the requested path itself is secret-looking')
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalToken
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('refuses listing "credentials" directly (requested path is secret-looking)', async () => {
    const tool = buildTool('list_repo_tree', scope)
    const result = JSON.parse(await tool.invoke({ path: 'credentials' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/secret|credential/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('refuses listing "config/.env" directly (requested path is secret-looking)', async () => {
    const tool = buildTool('list_repo_tree', scope)
    const result = JSON.parse(await tool.invoke({ path: 'config/.env' }))
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/secret|credential/i)
    expect(global.fetch).not.toHaveBeenCalled()
  })
})
