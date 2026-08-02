import type { ToolBuildSpec } from './mission'

/**
 * Representative Tool Builder fixtures used by tests/proofs:
 * - deterministic-valid: a known good local deterministic tool.
 * - deterministic-invalid: rejected at spec validation stage.
 * - sandbox-unavailable: valid spec but no registered sandbox implementation.
 */
export const TOOL_BUILDER_FIXTURES: Readonly<{
  deterministicValid: ToolBuildSpec
  deterministicInvalid: ToolBuildSpec
  sandboxUnavailable: ToolBuildSpec
}> = {
  deterministicValid: {
    id: 'count_words',
    version: '1.0.0',
    label: 'Count words',
    summary: 'Count words in a text.',
    kind: 'local-deterministic',
    mutates: false,
    risk: 'low',
    requiresConfirmation: false,
    secretRefs: [],
  },
  deterministicInvalid: {
    id: 'CountWords',
    version: 'v1',
    label: ' ',
    summary: '',
    kind: 'local-deterministic',
    mutates: true,
    risk: 'low',
    requiresConfirmation: false,
    secretRefs: ['BAD secret'],
  },
  sandboxUnavailable: {
    id: 'word_stats_advanced',
    version: '1.0.0',
    label: 'Word stats advanced',
    summary: 'Compute deterministic word stats.',
    kind: 'local-deterministic',
    mutates: false,
    risk: 'low',
    requiresConfirmation: false,
    secretRefs: [],
  },
}
