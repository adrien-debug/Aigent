# Testing

This repo has two test suites, run by two different npm scripts. **They are
not interchangeable — read the cost/prerequisites column before running
either.**

| | `npm test` | `npm run test:live` |
|---|---|---|
| Location | `tests/unit/**` | `tests/live/**` |
| Network | none | real HTTP to `npm run dev` (Next + LangGraph Agent Server) |
| Cost | **free** | **real OpenAI + GitHub API calls** (~$0.001–0.01 total per full run) |
| Prerequisites | none | `npm run dev` running, `.env.local` with a live gpu1 backend + `OPENAI_API_KEY` + `GITHUB_TOKEN` |
| Speed | <1s | ~10–20s (real network round trips) |
| CI-safe | yes, always | opt-in only |

Both are configured by the single `vitest.config.ts` at the repo root
(`environment: 'node'`, path alias `@/*` → `src/*`, and the `react-server`
resolve condition so `server-only`-guarded modules can be imported — the same
trick `npm run reprovision` uses via `tsx --conditions=react-server`).

## `npm test` — unit suite (`tests/unit/`)

Pure, offline, no servers, no secrets required. This is where the highest-value
regression coverage lives, because it runs on every commit for free.

- **`copilot-behavior.test.ts`** — `buildCopilotBehaviorConfig`
  (`src/lib/agent-mission-control/copilot-behavior.ts`). Covers **the exact bug
  that caused the production incident**: a copilot linked to a repo must
  ALWAYS get its 4 repo tools (`read_repo_file`, `list_repo_tree`,
  `search_repo`, `http_get`) mounted with a valid scope, even if the
  Architect's manifest proposed none of them (or only unresolvable free-form
  names) — and the mirror case: no repo → repo tools are never mounted with an
  empty scope. Also covers default-filling, system-prompt composition, and
  `draft_copilot_spec` always requiring confirmation.
- **`resolve-tool-id.test.ts`** — the free-form architect tool name → real
  registry id mapping (`resolveToolId`, internal to `copilot-behavior.ts`,
  exercised through `buildCopilotBehaviorConfig`'s `tools[]` output — its only
  observable effect). Covers the with-repo / without-repo branching
  (`read_project_file` → `read_repo_file` with a repo, → `read_project_summary`
  without), case/separator tolerance, and that unresolvable names are dropped
  rather than fabricated.
- **`tool-registry-secret-path.test.ts`** — `isSecretPath`
  (`src/langgraph/tool-registry.mjs`, internal, exercised through
  `buildTool('read_repo_file' | 'list_repo_tree', scope).invoke(...)`). This is
  a security denylist: refuses `.env`, `.env.local`, `*.pem`, `id_rsa`,
  `secrets.yml`, `*.key`, `credentials*`, `*.pfx`, `*.p12`; accepts
  look-alikes like `secretary.js` and normal files (`README.md`,
  `package.json`). Also checks `list_repo_tree` filters secret entries out of
  a directory listing.
- **`recursion-limit.test.ts`** — `recursionLimitFor`
  (`src/lib/agent-mission-control/langgraph-server.ts`, internal). Mocks
  `@langchain/langgraph-sdk`'s `Client` so no real Agent Server is needed, and
  asserts on the `config.recursion_limit` value passed to `runs.wait` — the
  formula's only observable effect. Covers the floor (25), proportional
  scaling, the cap (150), and `undefined`/`NaN` maxSteps leaving the SDK
  default untouched.
- **`budget-sentinel.test.ts`** — the step-budget sentinel, a transport
  contract between the LangGraph graph and the app. Pins both ends: the graph
  emits the sentinel as a prefix of the message **content** (not
  `additional_kwargs`/`response_metadata` — the SDK silently drops both), and
  the app detects + strips it before a human sees it. Without this contract a
  run that ran out of steps gets persisted as `completed`.
- **`benchmark-score.test.ts`** — pins `compositeScore()`
  (`benchmark-runner.ts`)'s formula so the safety-credit gate can't silently
  regress: safety points are gated on `eligibleTaskCount` (tasks that actually
  ran on the graph), so an inert agent that never acts can no longer outscore
  a working one. Pure arithmetic, no network.
- **`improvement-diagnosis.test.ts`** — the improvement loop's deterministic
  failure classifier (`diagnoseFailure` / `nextRecommendedAction` in
  `improvement-diagnosis.ts`). Load-bearing case: a `GraphRecursionError` must
  classify as `graph_recursion` → `graph_runtime_patch`, so the loop stops
  recommending manifest rewrites for what is actually a runtime bug.
- **`project-builder-preview.test.ts`** — the project builder's preview-patch
  merging (`mergePreview`, `selectPreviewOption`, `defaultAgentFlow`,
  `redactMessageContent`, `canStartDraftMaterialization` in
  `project-builder-preview.ts`): partial patches merge correctly, options
  dedupe by id, and message redaction/draft-gating behave as contracted.
- **`project-builder-repo-tools.test.ts`** — the project builder architect's
  agentic repo-reading loop (`generateArchitectTurn` in
  `project-builder-conversation.ts`), without any real OpenAI call: a mocked
  model's `read_repo_file` / `list_repo_tree` / `search_repo` tool calls are
  proven to hit the real `github.ts` helpers with the project's
  `repoFullName`, results feed back as `tool` messages, the loop re-calls the
  model until prose, iteration is bounded by `MAX_TOOL_ITERATIONS`, and no
  repo call happens when no repo is linked (fail-closed).
- **`project-builder-stream.test.ts`** — the project builder architect's SSE
  streaming transport (`streamArchitectTurn` /
  `postProjectBuilderMessageStream`). No real OpenAI call: the SDK client is
  mocked to yield `ChatCompletionChunk`-shaped deltas. Proves `onToken` fires
  once per content delta in order (not once at the end), the accumulated
  `reply` matches the full prose, a streamed `update_preview` tool-call is
  still captured correctly, repo-tool iterations never fire `onToken`, and
  persistence writes the same shape as the non-streaming path.
- **`release-gate.test.ts`** — `evaluateReleaseGate`
  (`release-gate.ts`), pure/offline with `pgrest` mocked: covers the
  promotion-critical checks the promotion route re-evaluates server-side
  before allowing a version to go to production.

Run: `npm test` (alias for `vitest run tests/unit`). **113 unit tests** across
these 11 files (add `--reporter=verbose` to see each one).

## `npm run test:live` — integration suite (`tests/live/`)

Opt-in. Requires `npm run dev` running in another terminal (starts Next on
`:3000`, falling back to `:3001` if occupied — `tests/live/helpers.ts` probes
both) **and** the LangGraph Agent Server on `:2024`. Also requires
`.env.local` populated with a live gpu1 backend, `OPENAI_API_KEY`, and
`GITHUB_TOKEN` (`tests/live/setup.ts` loads `.env.local` automatically via
Node's native `process.loadEnvFile`, same file `npm run dev` and
`npm run reprovision` use).

**Every test in this suite self-skips (logs a `[live] skip: …` note and
returns, never fails) when its prerequisites aren't met** — including when
some *other*, unrelated app happens to be listening on port 3000/3001
(`findAppBaseUrl` verifies it's actually reaching this app's `proxy.ts`, by
checking that an unauthenticated `GET /api/agent-ops/copilots` returns exactly
401 with this app's error shape, before treating a port as "this app").

- **`copilot-run.test.ts`** — **the test that would have caught the
  production incident.** Finds a live, repo-scoped, `langgraph`-runtime
  copilot, launches a real run whose prompt REQUIRES a repo read, then queries
  `tool_calls` directly via PostgREST (bypassing the HTTP response entirely —
  the original bug was a route that reported `completed` while lying about
  what happened) and asserts at least one row exists and it's a real repo
  tool. **Makes 1 real OpenAI call + 1 real GitHub read per run.**
- **`hitl-resume.test.ts`** — drives the full pause → resume cycle for the
  gated `draft_copilot_spec` tool and asserts the resumed `tool_calls` row
  carries the REAL tool name (`draft_copilot_spec`), not the `'tool'`
  placeholder — a real regression fixed in this repo's history. **Makes up to
  2 real OpenAI calls per run.** Note: whether the model actually emits the
  `draft_copilot_spec` tool call (vs. describing it in prose and asking the
  operator to reply "confirm") is not fully deterministic — see "Known
  finding" below. When it doesn't trigger, the test skips its resume
  assertions rather than failing.
- **`auth-and-security.test.ts`** — `proxy.ts`'s `x-amc-key` gate (401 on
  missing/wrong key), and `GET /api/agent-ops/github/file`'s security checks:
  refuses `.env` (403) and path traversal (400) before ever calling GitHub;
  serves a real file (`package.json`, 200, real `text` content) from a repo
  resolved dynamically from the live backend (never a hardcoded guess that
  might not be reachable).
- **`pages.test.ts`** — logs in via the real `/api/auth/login` route with
  `AMC_ADMIN_PASSWORD`, then checks `/admin` (Command Center copy: Production
  Agents / Projects / Requires Attention) and an agent-detail page return 200
  with that session cookie, that the removed list `/admin/agents` redirects to
  `/admin`, and that `/admin` without a cookie redirects (3xx) rather than
  rendering.

Run: `npm run test:live` (alias for `vitest run tests/live`).

### Known finding from writing this suite (not a test bug — reported, not fixed)

`hitl-resume.test.ts`'s trigger prompt consistently got the model to describe
the `draft_copilot_spec` call in prose and ask the operator to reply "confirm"
in a follow-up message, rather than actually emitting the tool call (which is
what makes the graph's `approvalNode` pause with `interrupt()` — confirmed by
reading `src/langgraph/agent-builder-graph.mjs`: the mechanism itself is
correct and pauses on any real tool call to a `confirmRequired` id). The
composed system prompt's "Ask a human to confirm before any risky tool call"
line (`composeSystemPrompt` in `copilot-behavior.ts`) appears to read to the
model as "ask in chat text" rather than "call it — the platform pauses it for
you." This was reproduced across 4 separate live runs with two different
prompt phrasings. Not fixed here (out of this suite's scope — tests only); the
test itself skips cleanly instead of false-failing when this happens.
