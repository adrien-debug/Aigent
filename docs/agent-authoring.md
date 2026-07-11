# Agent Authoring — how new copilots get created

Operator reference for the agent-authoring flow: creating a copilot from
scratch via the architect assistant, and running it for real. This is the
"write a new agent" path, distinct from managing existing copilots (registry,
versions, promotion gate, etc. — see `AGENTS.md` / `types.ts` for that surface).

## 1. Overview

- **Creation surface**: `/admin/agents/new`. A form + chat-style assistant
  where an operator describes the agent they want in natural language.
- **Architect assistant**: an LLM-backed step that takes the operator's
  description and produces a structured `AgentManifest` draft (system prompt
  summary, allowed routes, forbidden actions, confirmation policy, tool ids,
  cost/step limits) — not just prose. The draft is persisted before the
  copilot exists, so operators can iterate without creating a real record.
- **Real runner**: once a copilot + manifest exist, `/admin/agents/[id]` (or
  the run panel on the copilot detail page) can trigger a real execution —
  a live Anthropic call, not a mock/fixture. Output lands in `agent_runs` /
  `agent_run_steps` exactly like production traffic, so a hand-run test looks
  identical to a real run in the trace UI.

This flow has three server-only write points, all under
`app/api/agent-ops/`, following the existing PATCH pattern in
`app/api/agent-ops/copilots/[copilotId]/route.ts`.

## 2. Architecture

### `POST /api/agent-ops/copilots`
Creates a new `copilots` row (+ an initial `copilot_versions` / `manifests`
row as needed). Same server-only pattern as the existing PATCH handler:
reads `AMC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env, 503s if
`AMC_DATA_SOURCE !== 'gpu1'`, calls PostgREST (`fetch(`${base}/rest/v1/copilots`,
{ method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type':
'application/json', Prefer: 'return=representation' }, body })`). Sets
`created_via` on the new row (see §3).

### `POST /api/agent-ops/architect`
Takes the operator's natural-language description (and current draft
conversation state) and calls Anthropic (`claude-sonnet-4-5` via
`@anthropic-ai/sdk`) to generate/refine a structured manifest. Uses a tool
definition + `tool_choice` to force structured JSON output matching the
`AgentManifest` shape (`systemPromptSummary`, `allowedRoutes`,
`forbiddenActions`, `confirmationPolicy`, `alwaysConfirmActions`, `toolIds`,
`maxStepsPerRun`, `maxCostPerRunUsd`, etc. — see `src/lib/agent-mission-control/types.ts`).
Persists progress into `agent_drafts.generated_manifest` and
`agent_drafts.conversation` after each turn, so the assistant is resumable.
This is an LLM call — it consumes Anthropic API credits per turn.

### `POST /api/agent-ops/copilots/[id]/run`
Executes the copilot for real: loads its active manifest + tools, calls
Anthropic with the manifest's system prompt and tool set, and records the
execution as a normal `agent_runs` row with its `agent_run_steps` (kind:
`llm-call`, `tool-call`, `guardrail-check`, `output`, etc.). This is a real
Anthropic call, not a fixture — a manual "test run" from the admin UI shows
up in the same run history as production traffic, tagged via `created_via`.

All three routes are server components / route handlers only. The service
role key never reaches the client; the architect and run endpoints are the
only places in this flow allowed to call Anthropic (server-side, using
`ANTHROPIC_API_KEY`).

## 3. Data

New table, migration `0003` on GPU1 (following `0001_agent_mission_control.sql`,
`0002_validation_bench.sql`):

- **`agent_drafts`** — holds in-progress agent creation before a `copilots`
  row exists: `id, name, description, runtime, model, model_provider, owner,
  status (drafting|ready|created), generated_manifest jsonb, conversation
  jsonb, created_copilot_id, created_at, updated_at`. A draft moves
  `drafting → ready → created`; `created_copilot_id` links it to the
  resulting `copilots` row once `POST /api/agent-ops/copilots` runs.
- **`created_via` provenance columns** — added to the existing authoring
  path so every copilot/run can be traced back to how it was made (e.g.
  `architect-assistant` vs. manual/API creation). Same migration adds these
  alongside `agent_drafts`.

## 4. Env

`ANTHROPIC_API_KEY` is required for both the architect endpoint and the real
runner. Both fail closed: if the key (or `AMC_DATA_SOURCE=gpu1` / Supabase
env) is missing, the route returns an error rather than falling back to a
mock. There is no mock path for agent authoring — same fail-closed contract
as the rest of Agent Mission Control's data layer (`src/lib/agent-mission-control/data.ts`).

## 5. Cost note

Both the **architect assistant** (one Anthropic call per conversation turn
while drafting a manifest) and the **real runner** (one or more Anthropic
calls per execution, depending on tool-call loops) consume Anthropic API
credits. Iterating on a draft or hand-testing a copilot repeatedly is not
free — treat both as real usage, not sandboxed/mocked interactions.
