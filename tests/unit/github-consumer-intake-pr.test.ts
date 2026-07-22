import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Non-regression for AIGENT-DEEP-FORENSIC-029 P0
 * (provision-intake-pr-wipes-repo): the pull_request delivery path built its
 * git tree WITHOUT `base_tree`, so the resulting commit contained ONLY the
 * intake pack and every other file in the consumer repo read as deleted —
 * merging the PR wiped the repo. The direct_commit path already passed
 * base_tree; this proves the PR path now does too.
 *
 * We drive the real `provisionConsumerIntake` against a routed `fetch` mock and
 * assert the git/trees POST carries base_tree = the base branch head tree sha.
 */

const HEAD_SHA = 'headcommitsha1234567890'
const BASE_TREE_SHA = 'basetreesha0987654321'

type Body = Record<string, unknown> | undefined

function routeFetch() {
  const calls: { method: string; path: string; body: Body }[] = []
  const fetchMock = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const path = String(url).replace('https://api.github.com/', '')
    const method = (init?.method ?? 'GET').toUpperCase()
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined
    calls.push({ method, path, body })

    const json = (status: number, payload: unknown) =>
      ({
        status,
        ok: status >= 200 && status < 300,
        text: async () => JSON.stringify(payload),
      }) as unknown as Response

    // getDefaultBranch → GET repos/{owner}/{repo}
    if (method === 'GET' && /^repos\/[^/]+\/[^/]+$/.test(path)) return json(200, { default_branch: 'main' })
    // getConsumerProvisionStatus + repoFileExists → GET contents/... → 404 (not provisioned, no clash)
    if (method === 'GET' && path.includes('/contents/')) return json(404, { message: 'Not Found' })
    // GET git/refs/heads/main → head sha
    if (method === 'GET' && path.includes('/git/refs/heads/')) return json(200, { object: { sha: HEAD_SHA } })
    // GET git/commits/{sha} → head commit's tree sha (this is what base_tree must equal)
    if (method === 'GET' && path.includes('/git/commits/')) return json(200, { tree: { sha: BASE_TREE_SHA } })
    // POST git/refs (create delivery branch)
    if (method === 'POST' && /\/git\/refs$/.test(path)) return json(201, {})
    // POST git/blobs
    if (method === 'POST' && path.includes('/git/blobs')) return json(201, { sha: `blob-${calls.length}` })
    // POST git/trees
    if (method === 'POST' && path.includes('/git/trees')) return json(201, { sha: 'newtreesha' })
    // POST git/commits
    if (method === 'POST' && path.includes('/git/commits')) return json(201, { sha: 'newcommitsha', html_url: 'https://x/commit' })
    // PATCH git/refs/heads/{branch}
    if (method === 'PATCH' && path.includes('/git/refs/heads/')) return json(200, {})
    // POST pulls
    if (method === 'POST' && /\/pulls$/.test(path)) return json(201, { html_url: 'https://x/pr/7', number: 7 })

    throw new Error(`unrouted ${method} ${path}`)
  })
  return { fetchMock, calls }
}

describe('provisionConsumerIntake — pull_request delivery tree', () => {
  beforeEach(() => {
    vi.stubEnv('GITHUB_TOKEN', 'ghtok')
    vi.stubEnv('GITHUB_PUSH_ENABLED', '1')
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('passes base_tree so the PR layers the pack on top of the repo (never a wipe)', async () => {
    const { fetchMock, calls } = routeFetch()
    vi.stubGlobal('fetch', fetchMock)

    const { provisionConsumerIntake } = await import('@/lib/agent-mission-control/github')

    const result = await provisionConsumerIntake({
      project: {
        id: 'proj-x',
        name: 'Consumer X',
        slug: 'consumer-x',
        repoFullName: 'octo/consumer-x',
      } as never,
      mode: 'pull_request',
      dryRun: false,
      force: true,
    })

    const treePost = calls.find((c) => c.method === 'POST' && c.path.includes('/git/trees'))
    expect(treePost, 'a git/trees POST must be made').toBeTruthy()
    // The regression: base_tree missing => tree replaces the whole repo.
    expect(treePost!.body).toHaveProperty('base_tree', BASE_TREE_SHA)
    // And the pack is still layered in.
    expect(Array.isArray((treePost!.body as { tree: unknown[] }).tree)).toBe(true)
    expect((treePost!.body as { tree: unknown[] }).tree.length).toBeGreaterThan(0)

    expect(result.mode).toBe('pull_request')
    expect(result.pushed).toBe(true)
  })
})
