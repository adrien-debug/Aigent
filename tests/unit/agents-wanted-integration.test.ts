/**
 * Integration tests for loadAgentsWantedContext (agents-wanted.ts).
 *
 * Mocks getRepoFile from github.ts and verifies that:
 *  1. A populated AGENTS-WANTED.md is returned as a formatted block.
 *  2. A missing file (getRepoFile throws) returns null without crashing.
 *  3. GITHUB_TOKEN absent → null returned without calling github.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/agent-mission-control/github', () => ({
  getRepoFile: vi.fn(),
  getRepoTree: vi.fn(),
  searchRepoCode: vi.fn(),
}))

import { getRepoFile } from '@/lib/agent-mission-control/github'
import { loadAgentsWantedContext } from '@/lib/agent-mission-control/agents-wanted'

const REPO = 'acme/my-app'
const ORIGINAL_TOKEN = process.env.GITHUB_TOKEN

beforeEach(() => {
  vi.mocked(getRepoFile).mockReset()
  process.env.GITHUB_TOKEN = 'test-token'
})

afterEach(() => {
  process.env.GITHUB_TOKEN = ORIGINAL_TOKEN
})

describe('loadAgentsWantedContext', () => {
  it('returns a formatted block when AGENTS-WANTED.md has open requests', async () => {
    const content = `# Agents wanted — My App

## Open requests

### Risk sentinel
- **Priority:** high
- **Why:** We need pre-trade risk checks before ETH orders reach the book.
`
    vi.mocked(getRepoFile).mockResolvedValue({
      path: 'AGENTS-WANTED.md',
      encoding: 'utf-8',
      text: content,
      truncated: false,
    })

    const result = await loadAgentsWantedContext(REPO)

    expect(getRepoFile).toHaveBeenCalledTimes(1)
    expect(getRepoFile).toHaveBeenCalledWith(REPO, 'AGENTS-WANTED.md')
    expect(result).not.toBeNull()
    expect(result).toContain('## Workspace agent demand')
    expect(result).toContain('Risk sentinel')
  })

  it('returns null when the file does not exist (getRepoFile throws)', async () => {
    vi.mocked(getRepoFile).mockRejectedValue(new Error('GitHub 404'))

    const result = await loadAgentsWantedContext(REPO)

    expect(result).toBeNull()
  })

  it('returns null without calling github.ts when GITHUB_TOKEN is absent', async () => {
    delete process.env.GITHUB_TOKEN

    const result = await loadAgentsWantedContext(REPO)

    expect(result).toBeNull()
    expect(getRepoFile).not.toHaveBeenCalled()
  })

  it('returns null for undefined repoFullName', async () => {
    const result = await loadAgentsWantedContext(undefined)

    expect(result).toBeNull()
    expect(getRepoFile).not.toHaveBeenCalled()
  })

  it('appendAgentsWantedToContext leaves base unchanged when no open requests', async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      path: 'AGENTS-WANTED.md',
      encoding: 'utf-8',
      text: '## Open requests\n\n_No open requests yet — describe the first agent you need above._\n',
      truncated: false,
    })

    const { appendAgentsWantedToContext } = await import('@/lib/agent-mission-control/agents-wanted')
    const base = 'repo context'
    expect(await appendAgentsWantedToContext(base, REPO)).toBe(base)
  })

  it('appendAgentsWantedToContext appends wanted block to base context', async () => {
    vi.mocked(getRepoFile).mockResolvedValue({
      path: 'AGENTS-WANTED.md',
      encoding: 'utf-8',
      text: '## Open requests\n\n### Risk bot\n- **Priority:** high\n',
      truncated: false,
    })

    const { appendAgentsWantedToContext } = await import('@/lib/agent-mission-control/agents-wanted')
    const out = await appendAgentsWantedToContext('scan summary', REPO)
    expect(out).toContain('scan summary')
    expect(out).toContain('Risk bot')
  })
})
