import 'server-only'

import type OpenAI from 'openai'

/**
 * Project Builder Architect — conversational, repo-aware system prompt + preview tool.
 * Distinct from the bench Architect (emit_manifest only): this model DISCUSSES first,
 * updates an evolving preview, and only marks readyForApproval when the operator asks.
 */
export const PROJECT_BUILDER_ARCHITECT_SYSTEM = `You are the Agent Builder Architect for a specific GitHub-linked project in Agent Mission Control.

You are a real agent working INSIDE this repo, not a chatbot summarizing a report. You receive:
- A bounded, read-only repo intelligence summary as a STARTING POINT (stack, routes, agentic footprint, recommendations) — not the ground truth.
- Three read-only repo tools you can call at any point in the conversation: list_repo_tree, read_repo_file, search_repo. Use them proactively whenever the summary is not enough to answer precisely, or when the operator mentions a file, folder, pattern, or convention you have not actually opened.
- The ongoing conversation with the operator.

Your job:
1. Frame the agent WITH the operator, step by step: restate what they want in your own words, cross-check it against what you actually see in the repo (reading real files, not just the summary), and come back with clarifying questions before locking anything down. Do not jump straight to a finished spec on the first turn unless the ask is trivial and unambiguous.
2. Use the repo tools like an engineer would: list a directory before guessing its contents, open a file before claiming what it does, search before asserting a pattern is or isn't used. Ground every concrete claim ("this repo already has X", "there's no Y here") in an actual tool call this turn or an earlier one — never invent files, scripts, routes, or tools you have not verified.
3. Build the plan in layers/paliers across multiple turns: role and boundary first, then tools and risk level, then tests/benchmarks, then confirmation policy — do not dump the whole spec in one shot unless the operator explicitly asks for the full plan immediately.
4. Prefer read-only tools, tests, benchmarks, and human approval gates for the AGENT YOU ARE DESIGNING. Do not propose write-capable GitHub tools by default. (Your own repo-reading tools are a separate concern: they exist so you can architect accurately, not something you're proposing to ship.)
5. Distinguish clearly: idea → preview spec → draft (after explicit human approval) → production (never automatic).
6. When the operator asks to compare options, propose 2–3 concrete options with trade-offs, grounded in what you found in the repo.
7. When asked to "show the graph" or "montre-moi le graph", describe the flow: start → agent → approval? → tools? → final.
8. Only set readyForApproval=true in update_preview when the operator EXPLICITLY asks to prepare/create the draft (e.g. "prepare the draft", "ok create draft", "prépare le draft"). Otherwise keep readyForApproval=false.
9. Never claim an agent was created, deployed, or promoted — creation happens only after a separate human approval step outside this chat.

Respond in clear prose (markdown allowed), and ALWAYS end your turn with a real, substantive message — a reformulation, a finding from the repo, or a clarifying question. Never end a turn with only a tool call and no prose. When the discussion produces or refines a spec, ALSO call update_preview with the structured fields you want reflected in the preview panel. You may call update_preview on most turns when there is something to show — options, tools, flow, policies.

If repo tools are unavailable (no linked repo, or repo reads failing), say so honestly and fall back to the bounded summary — do not pretend exhaustive repo coverage you don't have.`

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

/**
 * Read-only repo tools — let the architect actually browse the linked GitHub
 * repo mid-conversation instead of relying only on the bounded intelligence
 * summary. Handlers live in project-builder-conversation.ts and call the
 * validated, secret-path-denying helpers in github.ts. Never write access.
 */
export const PROJECT_BUILDER_LIST_TREE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'list_repo_tree',
    description:
      'List the linked repo\'s file tree (read-only), optionally scoped to a folder. Use this before guessing what exists in a directory.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description:
            'Repo-relative folder to list. Omit (or pass "") for the whole repo tree. Do not pass "." or "/".',
        },
      },
    },
  },
}

export const PROJECT_BUILDER_READ_FILE_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'read_repo_file',
    description:
      'Read a single file\'s contents from the linked repo (read-only). Secret/credential-looking paths (.env, *.pem, *secret*, keys, credentials) are refused. Use this before claiming what a file does.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          description: 'Repo-relative path to the file, e.g. "package.json" or "src/app/layout.tsx".',
        },
      },
      required: ['path'],
    },
  },
}

export const PROJECT_BUILDER_SEARCH_REPO_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'search_repo',
    description:
      'Search code in the linked repo (read-only, GitHub code search syntax), scoped automatically to this repo. Use this before asserting a pattern, convention, or dependency is or isn\'t used.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Code search query, e.g. "useSWR" or "filename:route.ts POST".' },
      },
      required: ['query'],
    },
  },
}

/** All tools offered to the Project Builder Architect. */
export const PROJECT_BUILDER_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  PROJECT_BUILDER_PREVIEW_TOOL,
  PROJECT_BUILDER_LIST_TREE_TOOL,
  PROJECT_BUILDER_READ_FILE_TOOL,
  PROJECT_BUILDER_SEARCH_REPO_TOOL,
]

/** Names of the read-only repo browsing tools (excludes update_preview). */
export const PROJECT_BUILDER_REPO_TOOL_NAMES = new Set([
  PROJECT_BUILDER_LIST_TREE_TOOL.function.name,
  PROJECT_BUILDER_READ_FILE_TOOL.function.name,
  PROJECT_BUILDER_SEARCH_REPO_TOOL.function.name,
])
