/**
 * Agent Mission Control — repo-read tool mounting (PURE, no I/O).
 *
 * When a copilot's role implies repo inspection / diagnosis / codebase reading
 * and it is linked to a project repo, it MUST have the read-only repo tools
 * mounted (read_repo_file, list_repo_tree, search_repo) — otherwise repo-fit's
 * tool-fit check fails even though copilot-behavior injects them at runtime.
 *
 * This module centralises the detection + augmentation so authoring, suite
 * generation and the delivery scorecard all agree on the effective tool set.
 */

import type { ProposedTool } from './authoring-types'

/** Registry ids of the scoped, read-only repo tools. */
export const REPO_READ_TOOL_NAMES = ['read_repo_file', 'list_repo_tree', 'search_repo'] as const

type RepoReadToolName = (typeof REPO_READ_TOOL_NAMES)[number]

const WRITE_TOOL_HINT = /(write|delete|push|create|modify|commit|deploy|promote)/i

/**
 * True when the role/mission text signals repo inspection, diagnosis, or
 * codebase reading — the same heuristic repo-fit uses (extended with
 * diagnostic / project-context hints).
 */
export function claimsRepoInspectionRole(text: string): boolean {
  return /(inspect|inspection|analy|diagnos|scan|read|review|audit|repo|codebase|architecture|files?|project.context|repo.context)/i.test(
    text
  )
}

/** Default proposed-tool rows for the three read-only repo tools. */
export function defaultRepoReadProposedTools(): ProposedTool[] {
  return REPO_READ_TOOL_NAMES.map((name) => ({
    name,
    description: `${name} — read-only repo access`,
    provider: 'internal' as const,
    riskLevel: 'low' as const,
    requiresConfirmation: false,
  }))
}

/**
 * Augment a manifest's proposed tools with any missing repo-read tools when the
 * copilot is repo-linked and its role claims inspection. Never adds write tools.
 */
export function augmentProposedToolsWithRepoRead(
  tools: ProposedTool[],
  roleText: string,
  hasRepo: boolean
): ProposedTool[] {
  if (!hasRepo || !claimsRepoInspectionRole(roleText)) return tools

  const existing = new Set(tools.map((t) => t.name.toLowerCase()))
  const additions = defaultRepoReadProposedTools().filter((t) => !existing.has(t.name.toLowerCase()))
  if (additions.length === 0) return tools

  // Read-only repo tools first — matches the project's doctrine.
  return [...additions, ...tools]
}

/**
 * Effective tool names for repo-fit scoring: mounted DB tools + any repo-read
 * tools the role requires when the copilot is repo-linked.
 */
export function effectiveToolNamesForRepoFit(args: {
  toolNames: string[]
  roleText: string
  hasRepo: boolean
}): string[] {
  const names = new Set(args.toolNames.map((t) => t.toLowerCase()))
  if (args.hasRepo && claimsRepoInspectionRole(args.roleText)) {
    for (const t of REPO_READ_TOOL_NAMES) names.add(t)
  }
  return [...names]
}

/** True when a tool name looks write-capable (for policy checks). */
export function isWriteCapableToolName(name: string): boolean {
  return WRITE_TOOL_HINT.test(name)
}
