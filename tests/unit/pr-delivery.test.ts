/**
 * Unit tests for PR-based agent delivery (github.ts pushAgentToRepoPullRequest +
 * deliveryBranchName). GitHub API is mocked via global fetch — NO real network,
 * NO real push. Asserts: sanitized branch name, branch created off default HEAD,
 * files written to the DELIVERY branch (never default), PR opened, no merge call,
 * dry-run unchanged, and the direct-commit path is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  deliveryBranchName,
  pushAgentToRepo,
  pushAgentToRepoPullRequest,
} from '@/lib/agent-mission-control/github'
import type { AgentManifest, Copilot, Project } from '@/lib/agent-mission-control/types'

const project = { repoFullName: 'owner/repo' } as unknown as Project
const copilot = { slug: 'BTC Alert!!', name: 'BTC Alert', runtime: 'langgraph', model: 'gpt-5.4', id: 'copilot-x' } as unknown as Copilot
const manifest = {
  version: 'v0.2.0-draft',
  systemPromptSummary: 'Read-only test agent.',
  maxStepsPerRun: 12,
  confirmationPolicy: 'risky-only',
  allowedRoutes: ['/admin/agents'],
  forbiddenActions: ['write to repo'],
  alwaysConfirmActions: [],
  outputContract: { format: 'markdown', schemaName: null, invariants: [] },
  toolIds: [],
} as unknown as AgentManifest

// --- GitHub API double over fetch -----------------------------------------
type ApiCall = { method: string; path: string; body: unknown }
let apiCalls: ApiCall[]

function jsonRes(payload: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload) } as Response
}

function installGithub(opts: { branchExists?: boolean } = {}) {
  apiCalls = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url).replace('https://api.github.com/', '')
      const method = init?.method ?? 'GET'
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      apiCalls.push({ method, path: u, body })

      if (method === 'GET' && u.endsWith('/repository')) return jsonRes({ default_branch: 'main' })
      if (method === 'GET' && u === 'repos/owner/repo') return jsonRes({ default_branch: 'main' })
      if (method === 'GET' && u.includes('/contents/agents/_registry.json')) return jsonRes({ type: 'file', content: Buffer.from('[]').toString('base64'), encoding: 'base64' }, 200)
      if (method === 'GET' && u.includes('/git/refs/heads/')) return jsonRes({ object: { sha: 'headsha' } })
      if (method === 'GET' && u.includes('/git/commits/')) return jsonRes({ tree: { sha: 'basetree' } })
      if (method === 'POST' && u.endsWith('/git/refs')) {
        if (opts.branchExists) return jsonRes({ message: 'Reference already exists' }, 422)
        return jsonRes({ ref: body.ref })
      }
      if (method === 'POST' && u.endsWith('/git/blobs')) return jsonRes({ sha: 'blobsha' })
      if (method === 'POST' && u.endsWith('/git/trees')) return jsonRes({ sha: 'treesha' })
      if (method === 'POST' && u.endsWith('/git/commits')) return jsonRes({ sha: 'newcommit', html_url: 'https://github.com/owner/repo/commit/newcommit' })
      if (method === 'PATCH' && u.includes('/git/refs/heads/')) return jsonRes({})
      if (method === 'POST' && u.endsWith('/pulls')) return jsonRes({ html_url: 'https://github.com/owner/repo/pull/7', number: 7 })
      // Contents API for registry read fallback.
      if (method === 'GET' && u.includes('/contents/')) return jsonRes({ type: 'file', content: '', encoding: 'base64' })
      return jsonRes({}, 404)
    })
  )
}

describe('deliveryBranchName', () => {
  it('1 — sanitizes to lowercase [a-z0-9-], bounded, agent/ prefix', () => {
    expect(deliveryBranchName('BTC Alert!!', 'AbC123')).toBe('agent/btc-alert-abc123')
    expect(deliveryBranchName('  weird//slug  ', 'x')).toBe('agent/weird-slug-x')
    expect(deliveryBranchName('a'.repeat(200), 'r')).toMatch(/^agent\/a{1,60}-r$/)
  })
})

describe('pushAgentToRepoPullRequest', () => {
  const saved = { src: process.env.AMC_DATA_SOURCE, tok: process.env.GITHUB_TOKEN, armed: process.env.GITHUB_PUSH_ENABLED }
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
    process.env.GITHUB_PUSH_ENABLED = '1'
    installGithub()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.AMC_DATA_SOURCE = saved.src
    process.env.GITHUB_TOKEN = saved.tok
    process.env.GITHUB_PUSH_ENABLED = saved.armed
  })

  it('dry-run by default: no mutating call, planned branch returned', async () => {
    const r = await pushAgentToRepoPullRequest({ project, copilot, manifest, dryRun: true, runId: 'abc123' })
    expect(r.pushed).toBe(false)
    expect(r.dryRun).toBe(true)
    expect(r.mode).toBe('pull_request')
    expect(r.branch).toBe('agent/btc-alert-abc123')
    // No POST to git/refs, commits, or pulls in a dry-run.
    expect(apiCalls.some((c) => c.method === 'POST' && (c.path.endsWith('/git/refs') || c.path.endsWith('/pulls')))).toBe(false)
  })

  it('2/3/4 — creates branch off default HEAD, writes to it, opens PR, no merge', async () => {
    const r = await pushAgentToRepoPullRequest({ project, copilot, manifest, dryRun: false, runId: 'abc123' })
    expect(r.pushed).toBe(true)
    expect(r.prNumber).toBe(7)
    expect(r.prUrl).toBe('https://github.com/owner/repo/pull/7')
    expect(r.branch).toBe('agent/btc-alert-abc123')

    // Branch created from the default HEAD sha.
    const refCreate = apiCalls.find((c) => c.method === 'POST' && c.path.endsWith('/git/refs'))!
    expect((refCreate.body as { ref: string }).ref).toBe('refs/heads/agent/btc-alert-abc123')
    expect((refCreate.body as { sha: string }).sha).toBe('headsha')

    // Files advanced on the DELIVERY branch ref, never the default branch.
    const patches = apiCalls.filter((c) => c.method === 'PATCH' && c.path.includes('/git/refs/heads/'))
    expect(patches.every((p) => p.path.includes('agent/btc-alert-abc123'))).toBe(true)
    expect(patches.some((p) => p.path.endsWith('/git/refs/heads/main'))).toBe(false)

    // PR opened head→base.
    const pr = apiCalls.find((c) => c.method === 'POST' && c.path.endsWith('/pulls'))!
    expect((pr.body as { head: string }).head).toBe('agent/btc-alert-abc123')
    expect((pr.body as { base: string }).base).toBe('main')

    // 12 — NO merge call anywhere.
    expect(apiCalls.some((c) => c.method === 'PUT' && /\/pulls\/\d+\/merge/.test(c.path))).toBe(false)
    expect(apiCalls.some((c) => c.path.includes('/merge'))).toBe(false)
  })

  it('10 — PR body carries provenance + files, no secret, notes manual merge', async () => {
    await pushAgentToRepoPullRequest({ project, copilot, manifest, dryRun: false, runId: 'abc123', prBodyExtra: 'Delivery score 86' })
    const pr = apiCalls.find((c) => c.method === 'POST' && c.path.endsWith('/pulls'))!
    const body = (pr.body as { body: string }).body
    expect(body).toContain(copilot.slug) // raw slug shown in provenance
    expect(body).toContain('aigent')
    expect(body).toMatch(/manual/i)
    expect(body).toContain('Delivery score 86')
    expect(body).not.toMatch(/ghp_[A-Za-z0-9]/)
    expect(body).not.toMatch(/sk-[A-Za-z0-9]{20}/)
  })

  it('11 — branch_exists surfaced cleanly', async () => {
    installGithub({ branchExists: true })
    await expect(pushAgentToRepoPullRequest({ project, copilot, manifest, dryRun: false, runId: 'abc123' })).rejects.toThrow(/branch_exists/)
  })
})

describe('pushAgentToRepo (direct commit) — behaviour unchanged', () => {
  const saved = { tok: process.env.GITHUB_TOKEN, armed: process.env.GITHUB_PUSH_ENABLED }
  beforeEach(() => {
    process.env.GITHUB_TOKEN = 'test-token'
    installGithub()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    process.env.GITHUB_TOKEN = saved.tok
    process.env.GITHUB_PUSH_ENABLED = saved.armed
  })

  it('5/6 — dry-run unless armed; mode is direct_commit; no PR call', async () => {
    delete process.env.GITHUB_PUSH_ENABLED
    const r = await pushAgentToRepo({ project, copilot, manifest, dryRun: false })
    expect(r.dryRun).toBe(true) // env not armed → forced dry-run
    expect(r.mode).toBe('direct_commit')
    expect(apiCalls.some((c) => c.path.endsWith('/pulls'))).toBe(false)
  })
})
