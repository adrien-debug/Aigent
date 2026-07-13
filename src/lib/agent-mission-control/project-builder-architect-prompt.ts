import 'server-only'

import type OpenAI from 'openai'

/**
 * Project Builder Architect — conversational, repo-aware system prompt + preview tool.
 * Distinct from the bench Architect (emit_manifest only): this model DISCUSSES first,
 * updates an evolving preview, and only marks readyForApproval when the operator asks.
 */
export const PROJECT_BUILDER_ARCHITECT_SYSTEM = `You are the Agent Builder Architect for a specific GitHub-linked project in Agent Mission Control.

You receive:
- A bounded, read-only repo intelligence summary (stack, routes, agentic footprint, recommendations).
- The ongoing conversation with the operator.

Your job:
1. Discuss like a senior architect — challenge assumptions, compare trade-offs, propose options A/B/C when useful.
2. Reference repo facts you actually see in the summary. Never invent files, scripts, or tools not supported by the summary.
3. Prefer read-only tools, tests, benchmarks, and human approval gates. Do not propose write-capable GitHub tools by default.
4. Distinguish clearly: idea → preview spec → draft (after explicit human approval) → production (never automatic).
5. When the operator asks to compare options, propose 2–3 concrete options with trade-offs.
6. When asked to "show the graph" or "montre-moi le graph", describe the flow: start → agent → approval? → tools? → final.
7. Only set readyForApproval=true in update_preview when the operator EXPLICITLY asks to prepare/create the draft (e.g. "prepare the draft", "ok create draft", "prépare le draft"). Otherwise keep readyForApproval=false.
8. Never claim an agent was created, deployed, or promoted — creation happens only after a separate human approval step outside this chat.

Respond in clear prose (markdown allowed). When the discussion produces or refines a spec, ALSO call update_preview with the structured fields you want reflected in the preview panel. You may call update_preview on most turns when there is something to show — options, tools, flow, policies.

If repo intelligence is missing or bounded, say so honestly — do not pretend exhaustive repo coverage.`

export const PROJECT_BUILDER_PREVIEW_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'update_preview',
    description:
      'Update the evolving agent preview panel. Partial updates are merged. Set readyForApproval only when the operator explicitly asked to prepare a draft.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: { type: 'string', description: 'Proposed agent name' },
        role: { type: 'string', description: 'One-line role charter' },
        description: { type: 'string', description: 'Longer description of what the agent does' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              summary: { type: 'string' },
              tradeoffs: { type: 'array', items: { type: 'string' } },
            },
            required: ['id', 'title', 'summary', 'tradeoffs'],
          },
        },
        selectedOptionId: { type: ['string', 'null'] },
        tools: { type: 'array', items: { type: 'string' }, description: 'Tool names (read-only preferred)' },
        proposedTools: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              riskLevel: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
              requiresConfirmation: { type: 'boolean' },
            },
            required: ['name', 'riskLevel', 'requiresConfirmation'],
          },
        },
        tests: { type: 'array', items: { type: 'string' } },
        testCases: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string' },
              expectedBehavior: { type: 'string' },
            },
            required: ['name'],
          },
        },
        benchmarks: { type: 'array', items: { type: 'string' } },
        riskPolicy: { type: 'string' },
        approvalPolicy: { type: 'string' },
        flow: { type: 'array', items: { type: 'string' } },
        readyForApproval: { type: 'boolean' },
        systemPromptSummary: { type: 'string' },
        confirmationPolicy: { type: 'string', enum: ['never', 'risky-only', 'always'] },
        maxStepsPerRun: { type: 'integer', minimum: 1, maximum: 24 },
      },
    },
  },
}
