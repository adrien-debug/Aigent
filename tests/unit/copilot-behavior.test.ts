/**
 * Unit tests for buildCopilotBehaviorConfig (src/lib/agent-mission-control/copilot-behavior.ts).
 *
 * THIS IS THE BUG. Production incident: a copilot with a repo ran and reported
 * `status: completed`, but its tools were never mounted — the model
 * HALLUCINATED the repo's contents instead of calling read_repo_file /
 * list_repo_tree / search_repo. Root cause (per git history, see
 * bb857a2 "map architect tool names to real registry ids + guarantee repo
 * tools"): the Architect IA proposes FREE tool names on the manifest
 * (e.g. 'github_file_reader'), and if none of them resolved to a real repo
 * tool id, a repo-linked copilot could end up with ZERO repo tools even
 * though it has a repo. The fix guarantees the 4 repo tools
 * (read_repo_file, list_repo_tree, search_repo, http_get) are ALWAYS present
 * when repoFullName is set, regardless of what the architect proposed.
 *
 * These tests assert that guarantee holds, and its mirror image: no repo →
 * repo tools are dropped entirely (never mounted with an empty/undefined
 * scope, which would fail at runtime with "no repoFullName in scope").
 */
import { describe, expect, it } from 'vitest'

import {
  buildCopilotBehaviorConfig,
  composeSystemPrompt,
  type CopilotRowForBehavior,
  type ManifestRowForBehavior,
  type ToolRowForBehavior,
} from '@/lib/agent-mission-control/copilot-behavior'

const baseCopilot: CopilotRowForBehavior = {
  id: 'copilot-1',
  name: 'Repo Reviewer',
  model: null,
}

describe('buildCopilotBehaviorConfig — repo tool guarantee (the incident)', () => {
  it('injects all 4 repo tools when repoFullName is present, even if the architect proposed NONE of them', () => {
    // The architect manifest proposes tools that map to PLATFORM reads only —
    // none of them are repo-file/tree/search/http intents.
    const tools: ToolRowForBehavior[] = [
      { name: 'read_project_summary', risk_level: 'low', requires_confirmation: false },
    ]

    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools,
      repoFullName: 'hearst/console',
    })

    const ids = config.tools.map((t) => t.id)
    expect(ids).toEqual(
      expect.arrayContaining(['read_repo_file', 'list_repo_tree', 'search_repo', 'http_get'])
    )
  })

  it('scopes every injected repo tool to the copilot repoFullName (never mounted with an empty scope)', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools: [],
      repoFullName: 'hearst/console',
    })

    const repoToolIds = ['read_repo_file', 'list_repo_tree', 'search_repo'] as const
    for (const id of repoToolIds) {
      const entry = config.tools.find((t) => t.id === id)
      expect(entry, `expected ${id} to be present`).toBeDefined()
      expect(entry?.scope?.repoFullName).toBe('hearst/console')
    }

    const httpGet = config.tools.find((t) => t.id === 'http_get')
    expect(httpGet?.scope?.allowedHosts).toEqual(
      expect.arrayContaining(['api.github.com', 'raw.githubusercontent.com', 'github.com'])
    )
  })

  it('injects repo tools even when the architect DID propose an (unresolvable) github-ish tool name', () => {
    // Mirrors the exact prod shape: architect invents free names that don't
    // match any registry intent recognized by resolveToolId.
    const tools: ToolRowForBehavior[] = [
      { name: 'github_pull_request_drafter', risk_level: 'medium', requires_confirmation: true },
    ]

    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools,
      repoFullName: 'hearst/console',
    })

    const ids = config.tools.map((t) => t.id)
    expect(ids).toEqual(
      expect.arrayContaining(['read_repo_file', 'list_repo_tree', 'search_repo', 'http_get'])
    )
  })

  it('does NOT duplicate a repo tool the architect already declared — backfills scope on the existing entry', () => {
    const tools: ToolRowForBehavior[] = [
      { name: 'read_repo_file', risk_level: 'low', requires_confirmation: false },
    ]

    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools,
      repoFullName: 'hearst/console',
    })

    const readRepoFileEntries = config.tools.filter((t) => t.id === 'read_repo_file')
    expect(readRepoFileEntries).toHaveLength(1)
    expect(readRepoFileEntries[0].scope?.repoFullName).toBe('hearst/console')
  })

  it('drops repo tools entirely when the copilot has NO repo — never mounts them with an empty scope', () => {
    const tools: ToolRowForBehavior[] = [
      { name: 'read_project_file', risk_level: 'low', requires_confirmation: false },
    ]

    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools,
      repoFullName: null,
    })

    const ids = config.tools.map((t) => t.id)
    expect(ids).not.toContain('read_repo_file')
    expect(ids).not.toContain('list_repo_tree')
    expect(ids).not.toContain('search_repo')
  })

  it('a repo-linked copilot always ends up with at least the 4 repo tools + 5 generic tools (9 total minimum)', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools: [],
      repoFullName: 'hearst/console',
    })

    expect(config.tools.length).toBeGreaterThanOrEqual(9)
  })
})

describe('buildCopilotBehaviorConfig — defaults and composition', () => {
  it('falls back to defaults for a copilot with no manifest', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools: [],
      repoFullName: null,
    })

    expect(config.model).toBe('gpt-5.4')
    expect(config.maxSteps).toBe(12)
    expect(config.confirmationPolicy).toBe('risky-only')
    expect(config.copilotId).toBe('copilot-1')
    expect(config.copilotName).toBe('Repo Reviewer')
  })

  it('uses the copilot row model when present and non-blank', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: { ...baseCopilot, model: 'gpt-4.1' },
      manifest: null,
      tools: [],
      repoFullName: null,
    })
    expect(config.model).toBe('gpt-4.1')
  })

  it('treats a blank-string model as absent and falls back to the default', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: { ...baseCopilot, model: '   ' },
      manifest: null,
      tools: [],
      repoFullName: null,
    })
    expect(config.model).toBe('gpt-5.4')
  })

  it('reads maxSteps and confirmationPolicy from the manifest when present', () => {
    const manifest: ManifestRowForBehavior = {
      max_steps_per_run: 20,
      confirmation_policy: 'always',
    }
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest,
      tools: [],
      repoFullName: null,
    })
    expect(config.maxSteps).toBe(20)
    expect(config.confirmationPolicy).toBe('always')
  })

  it('draft_copilot_spec is always present and requires confirmation', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools: [],
      repoFullName: null,
    })
    const draft = config.tools.find((t) => t.id === 'draft_copilot_spec')
    expect(draft).toBeDefined()
    expect(draft?.requiresConfirmation).toBe(true)
  })
})

describe('composeSystemPrompt', () => {
  it('renders an honest default role when no manifest summary is given', () => {
    const prompt = composeSystemPrompt({ copilotName: 'Repo Reviewer', manifest: null, confirmationPolicy: 'risky-only' })
    expect(prompt).toContain('Repo Reviewer')
    expect(prompt).toContain('Honesty: never fabricate tool results, data, or success.')
  })

  it('includes forbidden actions, output contract and always-confirm actions when present', () => {
    const manifest: ManifestRowForBehavior = {
      system_prompt_summary: 'You review pull requests.',
      forbidden_actions: ['delete branches'],
      always_confirm_actions: ['open a pull request'],
      output_contract: { format: 'markdown', schemaName: 'ReviewReport', invariants: ['always cite file:line'] },
    }
    const prompt = composeSystemPrompt({ copilotName: 'Repo Reviewer', manifest, confirmationPolicy: 'risky-only' })
    expect(prompt).toContain('You review pull requests.')
    expect(prompt).toContain('- delete branches')
    expect(prompt).toContain('Respond in markdown format.')
    expect(prompt).toContain('"ReviewReport" schema')
    expect(prompt).toContain('always cite file:line')
    expect(prompt).toContain('- open a pull request')
  })

  it('never fabricates an empty section header when a manifest field is absent', () => {
    const prompt = composeSystemPrompt({ copilotName: 'X', manifest: {}, confirmationPolicy: 'never' })
    expect(prompt).not.toContain('You must never:')
    expect(prompt).not.toContain('Output contract:')
    expect(prompt).not.toContain('Always ask a human to approve')
  })
})

describe('buildCopilotBehaviorConfig — modelProvider', () => {
  it('defaults modelProvider to openai when the copilot row has none', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: baseCopilot,
      manifest: null,
      tools: [],
      repoFullName: null,
    })
    expect(config.modelProvider).toBe('openai')
  })

  it('carries model_provider from the copilot row into the behavior config', () => {
    const config = buildCopilotBehaviorConfig({
      copilot: { ...baseCopilot, model_provider: 'local', model: 'local-finance-32b' },
      manifest: null,
      tools: [],
      repoFullName: null,
    })
    expect(config.modelProvider).toBe('local')
    expect(config.model).toBe('local-finance-32b')
  })
})
