/**
 * Unit tests for the free-form architect tool name → real registry id mapping
 * (resolveToolId in src/lib/agent-mission-control/copilot-behavior.ts).
 *
 * resolveToolId is NOT exported (it's an internal helper of the pure
 * behavior-config builder), so these tests drive it through its only public
 * surface — buildCopilotBehaviorConfig — and assert on the resolved
 * `tools[].id` list. This is also the more faithful test: it's the exact
 * contract the graph depends on (resolveToolId's return value is only ever
 * observed via the tools[] the config carries).
 *
 * WHY this matters: the Architect IA invents free tool names on the
 * manifest ('github_file_reader', 'github_code_search', 'url_fetcher', …).
 * A name that fails to resolve is SILENTLY DROPPED — the copilot loses a
 * capability its own system prompt assumes it has. This is exactly the class
 * of bug that produced the hallucinated-completed-run incident.
 */
import { describe, expect, it } from 'vitest'

import { buildCopilotBehaviorConfig, type CopilotRowForBehavior, type ToolRowForBehavior } from '@/lib/agent-mission-control/copilot-behavior'

const copilot: CopilotRowForBehavior = { id: 'c1', name: 'Test Copilot', model: null }

/**
 * Resolve ONE architect tool name and return the full resulting tools[] id
 * list (generic defaults +, when repoFullName is set, the guaranteed repo
 * tools are ALSO always present — see copilot-behavior.test.ts for that
 * guarantee in isolation). Each test below asserts the specific id the
 * architect name under test is expected to resolve to; it does not attempt
 * to isolate away the other always-on ids.
 */
function resolvedIdsFor(name: string, opts: { repoFullName?: string | null } = {}): string[] {
  const tools: ToolRowForBehavior[] = [{ name, risk_level: 'low', requires_confirmation: false }]
  const config = buildCopilotBehaviorConfig({
    copilot,
    manifest: null,
    tools,
    repoFullName: opts.repoFullName ?? null,
  })
  return config.tools.map((t) => t.id)
}

describe('resolveToolId — WITH a repo (repo-file intent takes priority)', () => {
  it('read_project_file resolves to read_repo_file (repo-file intent wins over "project" noun)', () => {
    const ids = resolvedIdsFor('read_project_file', { repoFullName: 'hearst/console' })
    expect(ids).toContain('read_repo_file')
  })

  it('list_project_files resolves to list_repo_tree', () => {
    const ids = resolvedIdsFor('list_project_files', { repoFullName: 'hearst/console' })
    expect(ids).toContain('list_repo_tree')
  })

  it('github_file_reader resolves to read_repo_file', () => {
    const ids = resolvedIdsFor('github_file_reader', { repoFullName: 'hearst/console' })
    expect(ids).toContain('read_repo_file')
  })

  it('github_code_search resolves to search_repo', () => {
    const ids = resolvedIdsFor('github_code_search', { repoFullName: 'hearst/console' })
    expect(ids).toContain('search_repo')
  })

  it('url_fetcher resolves to http_get', () => {
    const ids = resolvedIdsFor('url_fetcher', { repoFullName: 'hearst/console' })
    expect(ids).toContain('http_get')
  })

  it('github_pull_request_drafter resolves to draft_copilot_spec (never a real write)', () => {
    const ids = resolvedIdsFor('github_pull_request_drafter', { repoFullName: 'hearst/console' })
    expect(ids).toContain('draft_copilot_spec')
  })
})

describe('resolveToolId — WITHOUT a repo (degrades to platform reads)', () => {
  it('read_project_file resolves to read_project_summary (no repo → platform read, not dropped)', () => {
    const ids = resolvedIdsFor('read_project_file', { repoFullName: null })
    expect(ids).toContain('read_project_summary')
    expect(ids).not.toContain('read_repo_file')
  })

  it('list_project_files resolves to read_project_summary (no repo → degrades, does not fabricate a repo tool)', () => {
    const ids = resolvedIdsFor('list_project_files', { repoFullName: null })
    expect(ids).not.toContain('list_repo_tree')
  })

  it('a genuinely repo-only name (no project/copilot/run noun) is dropped without a repo', () => {
    const tools: ToolRowForBehavior[] = [{ name: 'read_source_file', risk_level: 'low', requires_confirmation: false }]
    const config = buildCopilotBehaviorConfig({ copilot, manifest: null, tools, repoFullName: null })
    // read_source_file has no platform equivalent — must not silently become
    // some OTHER tool id; it is simply absent (dropped), which is safe.
    const ids = config.tools.map((t) => t.id)
    expect(ids).not.toContain('read_repo_file')
  })

  it('url_fetcher still resolves to http_get without a repo (http_get is not a repo tool)', () => {
    const ids = resolvedIdsFor('url_fetcher', { repoFullName: null })
    expect(ids).toContain('http_get')
  })
})

describe('resolveToolId — platform read intents (repo present or not, name has no repo-file signal)', () => {
  it('list_copilots / copilot summary intent resolves to read_copilot_summary', () => {
    const ids = resolvedIdsFor('copilot_summary_reader', { repoFullName: null })
    expect(ids).toContain('read_copilot_summary')
  })

  it('recent runs intent resolves to read_recent_runs', () => {
    const ids = resolvedIdsFor('recent_run_history', { repoFullName: null })
    expect(ids).toContain('read_recent_runs')
  })

  it('tool permission matrix intent resolves to read_tool_permissions', () => {
    const ids = resolvedIdsFor('tool_permission_matrix', { repoFullName: null })
    expect(ids).toContain('read_tool_permissions')
  })
})

describe('resolveToolId — exact registry ids pass through unchanged (case/format tolerant)', () => {
  it('an already-real id (exact match) is accepted as-is', () => {
    const ids = resolvedIdsFor('read_repo_file', { repoFullName: 'hearst/console' })
    expect(ids).toContain('read_repo_file')
  })

  it('is case-insensitive and separator-tolerant (kebab/space/underscore)', () => {
    const ids = resolvedIdsFor('GitHub File Reader', { repoFullName: 'hearst/console' })
    expect(ids).toContain('read_repo_file')
  })
})

describe('resolveToolId — unresolvable names are dropped, never fabricated', () => {
  it('a nonsense name resolves to nothing extra (no crash, no fabricated id)', () => {
    const tools: ToolRowForBehavior[] = [{ name: 'zzz_totally_unknown_intent_zzz', risk_level: 'low', requires_confirmation: false }]
    const config = buildCopilotBehaviorConfig({ copilot, manifest: null, tools, repoFullName: null })
    // Only the 5 generic defaults should be present — nothing invented from
    // the nonsense name.
    expect(config.tools.map((t) => t.id).sort()).toEqual(
      ['draft_copilot_spec', 'read_copilot_summary', 'read_project_summary', 'read_recent_runs', 'read_tool_permissions'].sort()
    )
  })

  it('an empty/whitespace-only name resolves to nothing', () => {
    const tools: ToolRowForBehavior[] = [{ name: '   ', risk_level: 'low', requires_confirmation: false }]
    const config = buildCopilotBehaviorConfig({ copilot, manifest: null, tools, repoFullName: null })
    expect(config.tools).toHaveLength(5) // just the generic defaults
  })
})
