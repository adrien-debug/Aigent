/**
 * Shared, PURE builder for a `draft_copilot_spec` proposal.
 *
 * A single source of truth for the draft shape, imported by BOTH execution
 * paths so they can never diverge:
 *   - the LangGraph graph (src/langgraph/agent-builder-graph.mjs), loaded by the
 *     separate `langgraphjs dev` process, and
 *   - the direct-loop tool handler (src/lib/agent-mission-control/tool-handlers.ts).
 *
 * No I/O, no `server-only`, no secrets — a plain function, so both a Node
 * subprocess and the Next server can import it. It NEVER persists anything; it
 * only returns a proposed spec object.
 */

const DEFAULT_MODEL = 'gpt-5.4'

/**
 * Build a least-privilege, read-only-first copilot draft.
 * @param {{ name?: string, description?: string, runtime?: string, model?: string }} hints
 * @returns the draft proposal object (persisted:false — never written)
 */
export function buildCopilotDraft(hints = {}) {
  const name = (typeof hints.name === 'string' && hints.name.trim()) || 'Untitled Copilot'
  const description =
    (typeof hints.description === 'string' && hints.description.trim()) ||
    'A new copilot drafted by Agent Builder Copilot, awaiting human review.'
  // langgraph is the only runtime with a real engine — default to it.
  // Defensive normalisation: the model sometimes hints an off-platform runtime
  // like 'default' (the prod symptom). That value has no engine here, so coerce
  // it to 'langgraph'. Shared by both callers (graph + tool-handlers.ts), so the
  // fix applies to every draft path. Kept trivial: only 'default' is remapped.
  const runtimeHint = (typeof hints.runtime === 'string' && hints.runtime.trim()) || ''
  const suggestedRuntime = !runtimeHint || runtimeHint === 'default' ? 'langgraph' : runtimeHint
  const suggestedModel =
    (typeof hints.model === 'string' && hints.model.trim()) || process.env.AGENT_BUILDER_MODEL || DEFAULT_MODEL

  return {
    name,
    description,
    suggestedRuntime,
    suggestedModel,
    // Start read-only: no write/destructive tools proposed by default.
    proposedTools: [
      { name: 'read_project_summary', riskLevel: 'low', requiresConfirmation: false, provider: 'internal' },
      { name: 'read_copilot_summary', riskLevel: 'low', requiresConfirmation: false, provider: 'internal' },
      { name: 'read_recent_runs', riskLevel: 'low', requiresConfirmation: false, provider: 'internal' },
      { name: 'read_tool_permissions', riskLevel: 'low', requiresConfirmation: false, provider: 'internal' },
    ],
    // Manifest skeleton — controlled posture spelled out for the gate.
    proposedManifest: {
      systemPromptSummary: `${name}: ${description} Operates read-only and human-in-the-loop; refuses forbidden actions.`,
      allowedRoutes: ['/admin/agents', '/admin/agents/*'],
      confirmationPolicy: 'risky-only',
      forbiddenActions: [
        'auto-promote to production',
        'push to external repos',
        'create write-capable tools without requiresConfirmation and a risk flag',
        'bypass any confirmation prompt or promotion gate',
      ],
      // On the validation bench, unassigned — assignment is the human act of validation.
      projectId: null,
      maxStepsPerRun: 12,
      maxCostPerRunUsd: 0.5,
    },
    // A starter test + benchmark plan so the draft is directly usable.
    proposedTestCases: [
      { name: 'Safe read-only happy path', kind: 'behavior', expectedBehavior: 'reads then answers', expectedToolCalls: [] },
      { name: 'Refuses out-of-scope write', kind: 'safety', expectedBehavior: 'refuses + offers a plan', expectedToolCalls: [] },
    ],
    proposedBenchmarkPlan: {
      dimensions: ['accuracy', 'safety', 'latency', 'cost'],
      note: 'plan only — not executed, not persisted',
    },
    // Explicit reminder for downstream consumers.
    persisted: false,
    note: 'Draft proposal only — not persisted. A human must confirm before anything is created.',
  }
}
