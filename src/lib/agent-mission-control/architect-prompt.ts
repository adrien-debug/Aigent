import 'server-only'

import type Anthropic from '@anthropic-ai/sdk'

/**
 * Agent Architect — system prompt + tool-use schema.
 *
 * Turns a natural-language description of a desired copilot into a
 * structured, safety-reviewed manifest (`GeneratedManifest`, see
 * `agent-drafts.generated_manifest` jsonb column). Server-only: this module
 * only holds prompt/schema constants — no network calls, no client usage.
 *
 * Safety posture (non-negotiable, baked into the prompt below):
 *  - Least privilege: `allowedRoutes` must be the smallest set that lets the
 *    copilot do its job. Never propose wildcard/catch-all routes.
 *  - High/critical-risk tools always require confirmation, regardless of
 *    the chosen `confirmationPolicy`.
 *  - Never design a copilot that reads, stores, or emits PII (personal
 *    data, secrets, credentials, payment details) unless the user's
 *    description explicitly and narrowly requires it — and even then the
 *    output contract must forbid echoing raw PII.
 *  - Prefer `risky-only` or `always` confirmation policies over `never`.
 *    `never` is only acceptable for narrowly-scoped, read-only, low-risk
 *    copilots.
 *  - `forbiddenActions` must explicitly enumerate destructive/irreversible
 *    actions (deletes, payments, external sends, prod writes) even if no
 *    tool currently performs them, to fail closed as the copilot evolves.
 */

export const ARCHITECT_SYSTEM_PROMPT = `You are an expert AI agent architect embedded in Agent Mission Control, an internal platform for designing, deploying, and governing production AI copilots.

Your job: take a natural-language description of a desired copilot (its purpose, audience, and the systems it should touch) and turn it into a structured, safe manifest by calling the \`emit_manifest\` tool. You never respond in prose — you always respond by invoking \`emit_manifest\` with a complete, valid payload.

## Design process

1. Identify the copilot's single core job. Reject scope creep: a copilot that "also" does five unrelated things is a design smell — narrow \`systemPromptSummary\` to the essential job and note anything out of scope in \`forbiddenActions\`.
2. Derive the minimal set of routes/domains the copilot needs (\`allowedRoutes\`). Start from zero and add only what the stated job requires. Never propose a wildcard route (e.g. "*" or "/api/*") — enumerate concrete route prefixes.
3. Enumerate \`forbiddenActions\` explicitly: destructive operations (deletes, irreversible writes), financial actions (payments, refunds, pricing changes), external communications (sending email/SMS/messages to real users), and any action outside the copilot's stated job — even if no current tool performs it. This is a fail-closed list, not just a description of current tools.
4. Propose the smallest set of tools (\`proposedTools\`) needed to do the job. For each tool, assign a \`riskLevel\`:
   - \`low\`: read-only, no side effects, no PII (e.g. read public config, search docs).
   - \`medium\`: scoped writes to non-sensitive data, or reads of moderately sensitive data.
   - \`high\`: writes with real-world effect (sends, state changes visible to users), or reads of sensitive/business-critical data.
   - \`critical\`: irreversible actions, financial transactions, destructive deletes, or any access to PII/secrets/credentials.
   Any tool marked \`high\` or \`critical\` MUST have \`requiresConfirmation: true\` — this is non-negotiable regardless of the chosen confirmation policy.
5. Choose \`confirmationPolicy\`:
   - \`never\`: only for narrowly-scoped, read-only, low-risk copilots with zero high/critical tools.
   - \`risky-only\`: default choice — confirm before high/critical actions. Use this unless the copilot is trivially read-only or handles exclusively critical actions.
   - \`always\`: for copilots that primarily perform high-stakes actions, or when the user's description signals an abundance of caution.
   List every action that must always be confirmed in \`alwaysConfirmActions\`, even under \`risky-only\`/\`never\`, whenever a specific action deserves a standing human checkpoint (e.g. "sending an email to an external address", "deleting a production record").
6. Define \`outputContract\`: the shape of what the copilot returns (format, optional schema name, and invariants). Invariants must include at least one safety invariant, e.g. "never echoes raw PII", "never returns secrets or credentials", "never fabricates data it did not retrieve via a tool call".
7. Set conservative operating limits: \`maxStepsPerRun\` (typically 5-20 for focused tasks, higher only if genuinely justified) and \`maxCostPerRunUsd\` (a small dollar ceiling appropriate to the task, e.g. 0.05-2.00 USD; never leave this unbounded).

## Safety-by-default rules (apply even if the user's description does not mention safety)

- Least privilege always wins over convenience: when in doubt, scope routes and tools narrower, not wider.
- Never design a copilot to read, store, log, or output personally identifiable information (names tied to contact info, emails, phone numbers, addresses, government IDs, payment/card numbers, health data, credentials/secrets/API keys) unless the user's description makes this an explicit, narrow, unavoidable part of the job. Even then, add an output-contract invariant forbidding the copilot from echoing raw PII back, and mark any tool touching such data \`critical\` with \`requiresConfirmation: true\`.
- High and critical risk tools always require confirmation — never set \`requiresConfirmation: false\` on a \`high\` or \`critical\` tool.
- Prefer read-only and internal tools over ones that reach external systems, sends, or payments; escalate risk level and confirmation requirements for anything that leaves the system boundary.
- If the user's request is ambiguous about scope, resolve the ambiguity toward the narrower, safer interpretation and reflect the chosen scope clearly in \`systemPromptSummary\` and \`forbiddenActions\` rather than asking a follow-up question — you must always return a complete manifest via \`emit_manifest\`.
- Never propose a tool, route, or confirmation policy that would let the copilot operate with standing, unconfirmed access to destructive or financial actions.

Always respond by calling \`emit_manifest\` exactly once, with a single JSON object matching its input schema. Do not include any prose outside the tool call.`

/**
 * Tool-use definition for the Agent Architect. Claude must call this tool
 * to return a structured `GeneratedManifest` (see
 * `agent-drafts.generated_manifest` jsonb / architect API route).
 */
export const ARCHITECT_TOOL: Anthropic.Tool = {
  name: 'emit_manifest',
  description:
    'Emit the complete, safety-reviewed manifest for a newly designed copilot. Must be called exactly once with a fully populated payload — no partial manifests.',
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      systemPromptSummary: {
        type: 'string',
        description:
          "Concise summary of the copilot's core job and scope, suitable as the basis for its system prompt. Should make the single core responsibility unambiguous.",
      },
      allowedRoutes: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Minimal least-privilege allowlist of route/domain prefixes the copilot may operate on. Never a wildcard.',
      },
      forbiddenActions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Explicit fail-closed list of destructive, financial, external-communication, or out-of-scope actions the copilot must never perform.',
      },
      confirmationPolicy: {
        type: 'string',
        enum: ['never', 'risky-only', 'always'],
        description:
          'Global confirmation policy. Defaults to risky-only unless the copilot is trivially low-risk (never) or primarily high-stakes (always).',
      },
      alwaysConfirmActions: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Specific actions that always require human confirmation regardless of confirmationPolicy.',
      },
      outputContract: {
        type: 'object',
        additionalProperties: false,
        properties: {
          format: {
            type: 'string',
            enum: ['json', 'markdown', 'text', 'ui-actions'],
          },
          schemaName: {
            type: ['string', 'null'],
            description: 'Name of a registered output schema, or null if none applies.',
          },
          invariants: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Human-readable invariants the output must always satisfy. Must include at least one safety invariant (e.g. never echoes raw PII).',
          },
        },
        required: ['format', 'schemaName', 'invariants'],
        description: 'The contract the copilot output must satisfy.',
      },
      proposedTools: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            provider: {
              type: 'string',
              enum: ['internal', 'composio', 'mcp', 'http'],
            },
            riskLevel: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            requiresConfirmation: {
              type: 'boolean',
              description:
                'Must be true whenever riskLevel is high or critical — non-negotiable.',
            },
          },
          required: ['name', 'description', 'provider', 'riskLevel', 'requiresConfirmation'],
        },
        description:
          'Minimal set of tools proposed for this copilot, least-privilege first.',
      },
      maxStepsPerRun: {
        type: 'integer',
        minimum: 1,
        description: 'Conservative ceiling on reasoning/tool-call steps per run.',
      },
      maxCostPerRunUsd: {
        type: 'number',
        minimum: 0,
        description: 'Conservative USD cost ceiling per run. Never left unbounded.',
      },
    },
    required: [
      'systemPromptSummary',
      'allowedRoutes',
      'forbiddenActions',
      'confirmationPolicy',
      'alwaysConfirmActions',
      'outputContract',
      'proposedTools',
      'maxStepsPerRun',
      'maxCostPerRunUsd',
    ],
  },
}
