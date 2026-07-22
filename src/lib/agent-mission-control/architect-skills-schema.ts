/**
 * Agent Mission Control — shared `skills` tool-parameter JSON schema.
 *
 * The identical `skills` array schema (3–7 mission-level product-verb
 * capabilities, NOT infrastructure tool names) is required by BOTH the bench
 * Architect's `emit_manifest` tool (`architect-prompt.ts`) and the Project
 * Builder Architect's `update_preview` tool (`project-builder-architect-prompt.ts`).
 * Defined once here so the two tool contracts stay byte-identical.
 *
 * Pure JSON Schema constant — no I/O, no secrets. Embedded as a property value
 * inside each tool's `parameters` (typed `Record<string, unknown>`).
 */

export const SKILLS_TOOL_PARAMETER = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      label: {
        type: 'string',
        description: 'Mission-level capability phrased as a product verb, e.g. "Read BTCUSDT spot price".',
      },
      detail: {
        type: 'string',
        description: 'Optional one-line explanation of how the agent realises this capability.',
      },
    },
    required: ['label'],
  },
  description:
    "The agent's mission-level skills — concrete capabilities it performs to fulfil its mission (e.g. read a market price, compute levels, emit a verdict). NOT infrastructure tool names. 3 to 7 items.",
}
