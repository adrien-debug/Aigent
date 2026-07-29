# Agent Authoring — how new copilots get created

Operator reference for the agent-authoring flow: creating a copilot from
scratch via the architect assistant, and running it for real. This is the
"write a new agent" path, distinct from managing existing copilots (registry,
versions, promotion gate, etc. — see `AGENTS.md` / `types.ts` for that surface).

## 1. Overview

- **Creation surface**: `/admin/agents/new`. A form + chat-style assistant
  where an operator describes the agent they want in natural language.
- **Architect assistant**: an LLM-backed step that takes the operator's
  description and produces a structured `GeneratedManifest` draft (system prompt
  summary, allowed routes, forbidden actions, confirmation policy, tool ids,
  cost/step limits) — not just prose.
- **Real runner**: once a copilot + manifest exist, `/admin/agents/[id]` (or
  the run panel on the copilot detail page) can trigger a real execution — a
  live OpenAI call, not a mock/fixture. Output lands in `agent_runs` /
  `agent_run_steps` exactly like production traffic, so a hand-run test looks
  identical to a real run in the trace UI.
- **Human-in-the-loop**: a copilot on the `langgraph` runtime runs on the
  official LangGraph Agent Server. A confirmation-required tool PAUSES the graph
  for human approval; the run is persisted as `needs-confirmation` and resumed
  by a dedicated route once the operator approves or rejects (see §4).
- **Improvement loop**: an existing copilot can be improved from its own real
  run/test/benchmark history — analyze → propose → materialize a V2 draft →
  compare → human decision (see §1c).

**Providers**: multi-provider on both the direct model-router path and the
LangGraph `agent_builder` graph (via `model-provider.mjs`).

- The **architect** uses `gpt-5.4` (`ARCHITECT_MODEL` in
  `src/lib/agent-mission-control/llm-client.ts`).
- The **LangGraph graph** reads `model` + `modelProvider` from each copilot's
  `CopilotBehaviorConfig` (`src/langgraph/model-provider.mjs`) and instantiates
  OpenAI, Gemini (OpenAI-compatible surface), or local vLLM accordingly.
- The **direct model-router path** (§3b,
  `src/lib/agent-mission-control/model-router.ts`) resolves the copilot's
  `model_provider` and routes to `openai` (OpenAI SDK),
  `google` (Gemini REST, including tool-use), or `local` (Adrien's vLLM park,
  OpenAI-compatible, explicit opt-in — never a silent redirect of defaults).
  `mistral` remains in the DB enum for legacy rows but is **not creatable**
  from the UI/API and is not wired at runtime.
- The live catalog today is the 4 TradeAgent copilots, all `runtime: 'langgraph'`,
  `model_provider = openai`, `gpt-5.4`.
- Migration `0005` tightened the `model_provider` / `runtime` CHECK constraints
  down to the OpenAI/Google/Mistral/local providers (no external LLM vendor beyond
  those).

This flow has several server-only write points, all under
`app/api/agent-ops/`, following the existing PATCH pattern in
`app/api/agent-ops/copilots/[copilotId]/route.ts`. The four core ones (§2
below covers each in detail):

1. `POST /api/agent-ops/copilots`
2. `POST /api/agent-ops/architect`
3. `POST /api/agent-ops/copilots/[copilotId]/run`
4. `POST /api/agent-ops/copilots/[copilotId]/runs/[runId]/resume`

Beyond these, the builder (§1b) and the improvement loop (§1c) each add their
own write points (`builder/run`, `builder/resume`, `builder/message`,
`builder/create-draft`, `builder/preview/select`, `improve/analyze`,
`improve/create-v2`, `improve/decision`, `push-agent`, project CRUD, …) — see
`.sweep/securite-routes-api.md` for the full, audited route inventory.

## 1b. Agent Builder Copilot — the meta copilot (activated)

The **Agent Builder Copilot** (slug `agent-builder-copilot`) is a real,
provisioned copilot whose job is to draft OTHER copilots, human-in-the-loop. It
lives on the validation bench (`project_id: null`) and runs on the LangGraph
`agent_builder` graph. It is now **visible and operable from the UI** — no
manual script required:

- **Provisioning** — `POST /api/agent-ops/copilots/provision-agent-builder`
  (idempotent: creates it if absent, returns the existing row untouched
  otherwise). The dashboard (`/admin`) and project surfaces are the UI entry;
  there is no dedicated copilots list page. The
  `npm run provision:agent-builder` script (→
  `scripts/provision-agent-builder.ts`) is the CLI fallback.
### Repo-aware project flow

From a **project** the builder can read the project's linked GitHub repo and
draft an agent contextualized to it:

- **Repo scan** — `POST /api/agent-ops/projects/[id]/repo/scan` → a read-only
  `RepoScanSummary` (stack, npm scripts, page/api routes, components, tests,
  design-system signals, risk notes) via `src/lib/agent-mission-control/repo-scan.ts`
  (which reads the repo tree + key files through `github.ts` — validated paths,
  secret files denied, timeout-bounded). NEVER writes to GitHub, NEVER returns a
  secret value.
- **Project builder** — server-side, driven by
  `POST …/projects/[id]/builder/run` which scans the repo, hands the summary to the
  graph as context, and runs to the approval interrupt. On approve,
  `POST …/projects/[id]/builder/resume` persists the draft **attached to the
  project** (`project_id` set, status draft, never production).
- **Streaming (SSE)** — `POST /api/agent-ops/projects/[id]/builder/message`
  (the conversational architect turn, distinct from the
  `run`/`resume` interrupt flow above) supports two transports on the same
  write path: plain JSON by default, or Server-Sent Events when the request
  sends `Accept: text/event-stream` (or `?stream=1`). In SSE mode each prose
  token is pushed as `data: {"delta":"..."}\n\n` as it is generated by
  `postProjectBuilderMessageStream` (`project-builder-conversation.ts`), then
  a final `data: {"done":true,"preview":...,"messageId":...}\n\n` event
  carries the same payload the JSON endpoint would return in one shot.
  Persistence is identical either way — streaming only changes how the prose
  is delivered to the browser, not what gets written to the DB.
- **Release proposal** — the run state carries a `releaseProposal`: proposed
  scaffold files, validation commands (the repo's REAL npm gates from the scan),
  a proposed branch, and a PR title/body. `prCreation: 'ships-next'` — NO code is
  pushed and NO PR is created in this flow.

### Bench flow

- **Workbench** — `/admin/agents/[id]/builder` (a Builder tab shown ONLY on the
  Agent Builder copilot). A textarea → **Run Agent Builder** → LangGraph node
  timeline → drafted manifest / tools / tests / risks → **Approve & create
  draft** / **Reject**, plus a link to the created copilot.
- **Builder routes** (real LangGraph runs — the bench copilot can't go through
  `executeCopilotRun`, which requires a project, so these call
  `runOnAgentServer`/`resumeOnAgentServer` directly; the Agent Server THREAD is
  the runId, and no `agent_runs` row is written for a bench builder run):
  - `POST /api/agent-ops/architect/run` `{ userInput }` → runs the graph to the
    first human-approval interrupt; returns the normalized `BuilderRunState`
    (`runId`, `status`, `currentNode`, `events[]`, `manifestDraft`,
    `selectedTools`, `testCases`, `risks`, `approvalRequired`, `createdCopilotId?`).
    The graph PAUSES at `draft_copilot_spec` BEFORE producing the draft, so a
    run reaching that step returns `status: 'awaiting_approval'` and creates
    NOTHING.
  - `POST /api/agent-ops/architect/resume` `{ runId, approved }` → continues the
    thread. On **approve** the gated tool runs (the draft is produced) and the
    approved side-effect is persisted: a real **draft copilot** on the bench
    (`status: 'draft'`, `project_id: null`, never production) via
    `createCopilotFromManifest`; `createdCopilotId` is returned. On **reject**
    the tool is blocked, nothing is created, and the run ends `blocked`.
  - `GET /api/agent-ops/architect/runs/[id]` → reads the run's current state
    from its LangGraph thread (source of truth). 404 if the thread is unknown
    (dev Agent Server restarted — see §9a).

  The normalization lives in `src/lib/agent-mission-control/agent-builder-run.ts`
  (server-only): it maps the thread's messages + the `draft_copilot_spec`
  ToolMessage into the `BuilderRunState` shape. It never mocks a run and never
  persists a draft without the human approval the graph's `approval` node
  enforces.

## 1c. Improvement loop — turning run signals into a V2

A copilot that already exists (created via the architect or the project
builder) can be improved from its own REAL execution history, human-gated at
the end. Three routes, all under
`app/api/agent-ops/copilots/[copilotId]/improve/`, backed by
`src/lib/agent-mission-control/improvement-loop.ts` and persisted in the
`improvement_proposals` table (migration `0010_improvement_proposals.sql`).

Flow — **collect → propose → materialize V2 → compare → decide**:

1. **`POST …/improve/analyze`** `{ triggeredBy? }` — collects real signals
   (failing test cases, benchmark scores, runs, LangGraph threads, LangSmith
   traces), has the architect model (`gpt-5.4` via `routeCompletion`)
   root-cause the failures and emit a **strict-JSON** manifest-patch
   proposal (never free-form prose), and persists it as an
   `improvement_proposals` row. Only one OPEN cycle at a time per copilot —
   409 if an undecided proposal (`proposed` / `v2-created`) already exists.
2. **`POST …/improve/create-v2`** `{ proposalId }` — materializes an
   accepted-for-trial proposal into a REAL V2 draft: new `manifests` +
   `copilot_versions` rows, `copilots.latest_version_id` moved, and the
   copilot's LangGraph assistant re-provisioned so the V2 behaviour actually
   runs. The version stays `draft` — promotion to production remains the
   separate, existing promotion route, always human-triggered.
3. Re-run the existing test/benchmark runners pinned to the V2 version id,
   then **compare** — latest completed runs per version, recomputed live
   (never persisted, so numbers can't drift from `test_runs`/`benchmark_runs`).
4. **`POST …/improve/decision`** `{ proposalId, decision: 'approved' |
   'rejected', decidedBy? }` — the human gate: records approve/reject on the
   proposal row. Approving does NOT itself promote anything to production;
   it only records the decision (409 if already decided, or if approving
   before a V2 draft exists).

The proposal may only touch behaviour fields derived in
`copilot-behavior.ts` (system prompt summary, forbidden actions,
always-confirm actions, confirmation policy, max steps per run, output-contract
invariants). Tools are read-only by doctrine and never added/removed by this
loop; confirmation policy can only tighten. The LLM's proposal is treated as
untrusted input and server-validated before being persisted.

## 2. Architecture

### `POST /api/agent-ops/copilots`
Creates a new `copilots` row (+ an initial `copilot_versions` / `manifests`
row as needed). Same server-only pattern as the existing PATCH handler:
reads `AMC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from env, 503s if
`AMC_DATA_SOURCE !== 'gpu1'`, calls PostgREST (`fetch(`${base}/rest/v1/copilots`,
{ method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type':
'application/json', Prefer: 'return=representation' }, body })`). Sets
`created_via` on the new row.

### `POST /api/agent-ops/architect`
Takes the operator's natural-language description (the running
`ArchitectMessage[]` conversation) and calls OpenAI (`gpt-5.4` via the OpenAI
SDK) to generate/refine a structured manifest. Uses a tool definition
(`emit_manifest`) with `tool_choice: 'auto'` so the model returns structured
JSON matching the `GeneratedManifest` shape (`systemPromptSummary`,
`allowedRoutes`, `forbiddenActions`, `confirmationPolicy`,
`alwaysConfirmActions`, `toolIds`, `maxStepsPerRun`, `maxCostPerRunUsd`, etc. —
see `src/lib/agent-mission-control/authoring-types.ts`). The endpoint is
**stateless**: it takes the conversation in and returns `{ reply, manifest }`;
it does not itself write a draft row per turn. Fail-closed 503 without
`OPENAI_API_KEY` / `AMC_DATA_SOURCE=gpu1`. This is an LLM call — it consumes
OpenAI API credits per turn.

### `POST /api/agent-ops/copilots/[copilotId]/run`
Executes the copilot for real and records it as a normal `agent_runs` row with
its `agent_run_steps` and `tool_calls`. Loads the copilot (model, serving
version, project) + that version's manifest, then delegates to the shared
runner `executeCopilotRun` (`src/lib/agent-mission-control/runner.ts`). The
runner **splits on runtime** (see §3). The response echoes the run outcome and,
for a paused LangGraph run, `interrupted` / `interruptMessage` / `pendingTool`
so the client can show an Approve/Reject prompt (see §4). Fail-closed 503
without the gpu1 backend + `OPENAI_API_KEY`; never fabricates a run
(persists a `failed` row on model failure).

### `POST /api/agent-ops/copilots/[copilotId]/runs/[runId]/resume`
The human-in-the-loop resume for a LangGraph run that paused for approval.
Body `{ approved: boolean }`. Gates the run (must exist, belong to this copilot,
be `needs-confirmation`, carry a resumable `thread_id`), resumes the graph on
the Agent Server with the decision, appends the resumed steps + tool calls,
then PATCHes the run to `completed` (or `blocked` when a rejection left every
tool call blocked). See §4 for the full lifecycle.

All four routes are route handlers only. The service role key never reaches the
client; the architect, run and resume endpoints are the only places in this
flow allowed to talk to OpenAI / the Agent Server (server-side, using
`OPENAI_API_KEY`).

## 3. Two execution paths (runtime split)

`executeCopilotRun` resolves the copilot's `runtime` (explicit arg, else loaded
from the copilot row) and picks one of two engines:

### (a) `runtime === 'langgraph'` → official LangGraph Agent Server
Delegates to `executeViaLangGraph`, which calls
`src/lib/agent-mission-control/langgraph-server.ts`
(`runOnAgentServer` / `resumeOnAgentServer`). The app **does not embed a
LangGraph engine**: runs go to the official LangGraph Agent Server
(`langgraphjs dev` on `:2024` — the same server LangSmith Studio connects to)
via the official SDK (`@langchain/langgraph-sdk`). That server owns the graph,
checkpointing, streaming and interrupt/resume; this module is a thin client
(create a thread → run → surface an interrupt or the final answer → hand back a
normalized shape the runner persists into `agent_runs` / `agent_run_steps` /
`tool_calls`).

The graph itself is a real, standard `StateGraph` in
`src/langgraph/agent-builder-graph.mjs` (exported as `graph`, declared in
`langgraph.json` under the id `agent_builder`). Shape:
**agent → approval → tools → agent** (loop), with `agent` a `ChatOpenAI`. Tool
binding is **dynamic**: `buildToolsFromConfig` reads the tool set from
`config.configurable` (the per-assistant config provisioned by
`ensureProjectAssistant` / `ensureCopilotAssistant`, §9b), so a provisioned
assistant's actual tools depend on its manifest. The "five tools" shape below
is the **legacy fallback** used only when the graph runs with no
`config.configurable` at all (bare `config: {}`) — four read-only PostgREST
reads (`read_project_summary`, `read_copilot_summary`, `read_recent_runs`,
`read_tool_permissions`) plus the gated write `draft_copilot_spec` (which only
proposes a spec; it never persists). `parallel_tool_calls: false` forces one
tool per turn so the approval gate lands deterministically on a single call.

**The project builder's architect is a different, more capable agent.** The
conversational architect used in the project builder modal (§1b) is NOT this
graph — it runs its own agentic loop in
`src/lib/agent-mission-control/project-builder-conversation.ts`, bound to
**three real repo-reading tools** (`list_repo_tree`, `read_repo_file`,
`search_repo`) backed by `github.ts` (validated paths, secret files denied,
timeout-bounded — see `runRepoTool`). The loop caps at `MAX_TOOL_ITERATIONS = 8`
round-trips per turn (bounds cost/latency), truncates tool output to 6,000
chars before feeding it back to the model, and is the same call that streams
its prose over SSE (above). This is what makes the project builder's architect
"a real agent inside the repo", not just a chat wrapper — see
`project-builder-conversation.ts` (tool-dispatch loop) for the implementation.

### (b) any other runtime → direct model-router loop
The runner runs the agentic loop itself via the **multi-provider** model router
(`src/lib/agent-mission-control/model-router.ts`), which resolves the copilot's
`model_provider` and dispatches to **OpenAI**, **Gemini** (`google`), or the
**local vLLM park** (`local`, opt-in). The loop: resolve the manifest's tool
set, call the model, run each requested tool through the guardrail
(allowed? risky? requires confirmation?), execute allowed read-only handlers,
feed results back, loop until a final answer or the manifest step budget. A
confirmation-required tool is BLOCKED here (never auto-executed) unless its name
is passed in `confirmedToolNames`. This path has no Agent Server thread and
never interrupts for approval.

## 4. Human-in-the-loop (LangGraph path)

The canonical interrupt/resume flow, provided by the runtime — not hand-rolled:

1. The graph's `approval` node inspects the agent's single requested tool. Read
   tools fall straight through to `tools`. A confirmation-required tool
   (`draft_copilot_spec`, in the graph's `CONFIRM_REQUIRED` set) calls
   `interrupt(...)` with a human-facing payload (`action`, `risk`, `proposed`,
   `message`). The graph PAUSES — no side effect runs before the pause, so
   replay is free.
2. `runOnAgentServer` detects the interrupt, extracts the approval message + the
   pending tool, and returns `interrupted: true` with the Agent Server
   `threadId`. The runner persists the run as **`needs-confirmation`** with
   `thread_id` set (nullable column added by
   `0006_agent_run_thread.sql`) and `finished_at` left null (a paused run is
   not finished). `POST …/run` returns `interrupted` / `interruptMessage` /
   `pendingTool` to the client.
3. The operator approves or rejects. `POST …/runs/[runId]/resume { approved }`
   validates the run is `needs-confirmation` with a resumable `thread_id`, then
   calls `resumeOnAgentServer({ threadId, approved })`, which continues the
   graph with `Command({ resume: { approved } })`. **Approve** → the gated tool
   runs and the graph finishes (run → `completed`). **Reject** → the approval
   node emits a blocked `ToolMessage` so the tool never runs (run → `blocked`
   when every tool call ended blocked). The route appends the resumed steps +
   tool calls, re-aggregates the run counters, and stamps `finished_at`.

## 5. Data

Live schema on GPU1 (base `aigent`), migrations in `supabase/migrations/`:

- **`0001_agent_mission_control.sql`** — initial schema: `projects`, `copilots`,
  `copilot_versions`, `manifests`, `tools`, test/benchmark tables, and the run
  tables `agent_runs` / `agent_run_steps` / `tool_calls`. RLS on, service_role
  only (internal console, zero anon policy).
- **`0002_validation_bench.sql`** — makes `copilots.project_id` nullable
  (null = on the validation bench, not yet assigned) and adds
  `target_project_ids`.
- **`0003_project_images.sql`** — adds `image_url` / `logo_url` to `projects`.
- **`0004_project_github.sql`** — adds the GitHub repo link (`repo_url`,
  `repo_full_name`) and per-copilot push state (`last_push_status`,
  `last_pushed_at`, `last_push_commit_url`).
- **`0005_drop_anthropic_provider.sql`** — drops Anthropic from the
  `model_provider` set, tightening the `runtime` / `model_provider` CHECK
  constraints down to the supported set (`openai` / `google` / `mistral` /
  `local`; runtimes `langgraph` / `openai-assistants` / `gemini` / `custom`).
  These providers are real on the **direct** path (§3b): OpenAI, Gemini
  (`google`), and local vLLM (`local`) all execute. The **LangGraph** path reads
  `modelProvider` from `CopilotBehaviorConfig` and routes through
  `model-provider.mjs` (openai / google / local). `mistral` is legacy-only.
- **`0006_agent_run_thread.sql`** — adds the nullable `agent_runs.thread_id`,
  the Agent Server thread persisted on a `needs-confirmation` run so it can be
  resumed (§4). Only LangGraph runs set it.
- **`0007_created_via.sql`** — adds `copilots.created_via` (provenance: which
  flow created the copilot — architect, project builder, manual, etc.).
- **`0008_project_assistant.sql`** — adds `projects.assistant_id`, the
  per-project LangGraph assistant id (§9b).
- **`0009_copilot_assistant.sql`** — adds `copilots.assistant_id`, the
  per-copilot LangGraph assistant id (§9b).
- **`0010_improvement_proposals.sql`** — adds the `improvement_proposals`
  table backing the improvement loop (§1c).
- **`0011_project_repo_intelligence.sql`** — adds `projects.repo_intelligence`
  (jsonb), `repo_intelligence_at`, `repo_intelligence_sha` — no new table, a
  persistent cache of the last repo scan on the existing `projects` row,
  backing `repo-intelligence-store.ts` / `loadRepoIntelligence`.
- **`0012_project_builder_conversations.sql`** — adds
  `project_builder_conversations` and `project_builder_messages`, the
  persistent store backing the project builder modal's chat (§1b).
- **`0013_manifest_skills.sql`** — adds `manifests.skills` (jsonb, default
  `[]`) — no new table, the agent's mission-level skills derived by the Agent
  Builder, surfaced on the copilot overview's Skills card.

> The architect's in-progress draft type (`agent_drafts` /
> `GeneratedManifest`) lives in
> `src/lib/agent-mission-control/authoring-types.ts`. There is **no**
> `agent_drafts` migration in this tree — no SQL file creates that table. Do not
> assume a persisted drafts table exists from this doc; the architect endpoint
> (§2) is stateless and returns the manifest to the caller.

## 6. Running it locally

`npm run dev` starts **both** servers concurrently:

- **Next.js** (`next dev`) — the app.
- **LangGraph Agent Server** (`langgraphjs dev --host 127.0.0.1 --port 2024
  --n-jobs-per-worker 2`) — serves the `agent_builder` graph. The CLI default
  is 10 workers; we cap at 2 for local dev CPU. (`npm run langgraph` runs it
  alone; `npm run langgraph:studio` opens LangSmith Studio pointed at it.)
- If Turbopack dev feels stuck or `.next/` has grown huge, `npm run dev:clean`
  wipes the dev cache then restarts both servers.

LangSmith Studio connects to `http://127.0.0.1:2024` to visualise / debug the
graph and its interrupt/resume flow.

## 7. Env

- **`OPENAI_API_KEY`** — required for the architect endpoint, the LangGraph
  Agent Server (which reads it from `.env.local`), and any copilot whose
  `model_provider = openai`. Every provider path is fail-closed: a missing
  credential (or missing `AMC_DATA_SOURCE=gpu1` / Supabase env) returns an error
  rather than a mock. There is no mock path for agent authoring — same
  fail-closed contract as the rest of Agent Mission Control's data layer
  (`src/lib/agent-mission-control/data.ts`).
- **`GEMINI_API_KEY`** (or `GOOGLE_API_KEY`) — required for copilots whose
  `model_provider = google` on the direct path (§3b). Absent → the router raises
  `ProviderUnavailableError`, never a silent fallback.
- **`VLLM_LOCAL_API_KEY`** + the per-endpoint URL vars (see
  `src/lib/agent-mission-control/model-local.ts`) — required for copilots whose
  `model_provider = local` (Adrien's vLLM park, opt-in).
  Endpoint down/unconfigured → `ProviderUnavailableError` (explicit, non-silent).
- **`LANGGRAPH_API_URL`** — base URL of the Agent Server, default
  `http://127.0.0.1:2024`. Override to point at a remote deployment.
- **`AGENT_BUILDER_MODEL`** — the model the LangGraph graph binds, default
  `gpt-5.4` (OpenAI — the LangGraph path is OpenAI-only).

## 8. Cost note

Both the **architect assistant** (one OpenAI call per conversation turn while
drafting a manifest) and the **real runner / resume** (one or more OpenAI calls
per execution, depending on tool-call loops) consume OpenAI API credits.
Iterating on a draft or hand-testing a copilot repeatedly is not free — treat
both as real usage, not sandboxed/mocked interactions.

## 9. Known limitation — in-memory thread state AND in-memory assistants

The dev LangGraph Agent Server (`langgraphjs dev`) keeps **both** thread state
and provisioned assistants **in memory**. These are two separate failure
modes — read both.

### 9a. Threads (loud failure — safe)

Restarting the Agent Server drops all threads, so a run left in
`needs-confirmation` becomes unresumable: `POST …/runs/[runId]/resume` detects
the lost thread (a 404 from the server) and returns **409** with
`threadLost: true` and the message *"the approval thread was lost (Agent Server
restarted) — relaunch the run"*. Relaunch the run to get a fresh, resumable
thread. This failure is loud and correctly reported — nothing to fix here, it
is just a UX consequence of the free `langgraphjs dev` server having no
Postgres/Redis backing (see `deploy/langgraph/README.md`'s persistence
section: a Docker volume over `.langgraph_api` mitigates this in production
by persisting the checkpoint/thread files across container restarts).

### 9b. Assistants (silent failure — the traitorous one)

**Provisioned assistants** (per-project / per-copilot, created via
`ensureProjectAssistant` / `ensureCopilotAssistant` in
`src/lib/agent-mission-control/langgraph-assistants.ts`, each carrying its own
`config.configurable` — tools, system prompt, behaviour) are **also
in-memory-only** on the Agent Server. Unlike threads, **the persistent
`.langgraph_api` Docker volume used in production does NOT save them either**
— verified by inspecting its contents
(`.langgraphjs_api.checkpointer.json`, `.langgraphjs_api.store.json`,
`.langgraphjs_ops.json`): none contain `assistant_id`. A server restart wipes
every assistant while the `aigent` Postgres (`projects.assistant_id` /
`copilots.assistant_id`) keeps pointing at the now-vanished ids.

**Why this is worse than 9a:** a run against a vanished assistant id does
*not* fail loudly by default. Historically the dispatch path swallowed the
404 and fell back to the **bare `agent_builder` graph with `config: {}`** —
no tools mounted — and the model **hallucinated** (observed: a copilot
invented a GitHub repo's contents from nothing) while the run still reported
**`completed`**. No error, no failed status — just a confidently wrong
answer nobody was warned about.

**The two mitigations (already wired, do not reimplement):**

1. **`src/lib/agent-mission-control/resolve-run-assistant.ts`** — the single
   place every run path resolves "which assistant does this run target?".
   Before returning an id, it verifies the assistant is live on the Agent
   Server and **re-provisions it on the spot** if it's gone (same
   deterministic id, current config). If re-provisioning itself fails, the
   error now propagates loudly instead of falling through to the bare graph.
   This closes the silent-hallucination hole at request time, at the cost of
   extra latency on the first run after a restart.
2. **`scripts/reprovision-assistants.ts`** (`npm run reprovision`) — bulk,
   idempotent re-provisioning of every project's and copilot's assistant,
   persisting ids back to Postgres. Safe to run any time.

**Production operational procedure:** `deploy/app/docker-compose.yml` wires
mitigation 2 to run **automatically** via its `reprovision` service — once at
boot (after waiting for PostgREST + the Agent Server to be reachable) and then
every `REPROVISION_INTERVAL_SECONDS` (default 15 min) for as long as the
stack is up, with its own Docker healthcheck that goes `unhealthy` once the
last successful pass is stale (2× the interval) — see
`deploy/langgraph/README.md`'s "Assistants are in-memory too" section for the
full mechanism. **If the Agent Server is ever restarted outside of a full
app redeploy** (e.g. `docker compose -f deploy/langgraph/docker-compose.yml
restart agent-server`), either wait for the next automatic reconciliation
pass or run `npm run reprovision` by hand immediately to close the window.
