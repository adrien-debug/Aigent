# Aigent — Agent Mission Control

**The central plane where LLM agents are created, qualified, shipped, observed
and improved.** Aigent is not the product an end user touches: the agents it
produces run inside *consumer* products, those products report their runs back
here, and Aigent turns that history into governed V2s.

```
   create → qualify → ship ──► CONSUMER PRODUCT executes the agent
      ↑                                    │
      └──── improve ◄──── telemetry ◄──────┘
```

- **`docs/product-vision.md`** — what the platform is for, and what it is not.
- **`docs/current-capabilities.md`** — every capability with its real state
  (wired / partial / backend-only / not wired) and the file that proves it.
- **`docs/architecture.md`** — layers, trust boundaries, directory map.
- **`docs/known-gaps.md`** — what is honestly missing.

Everything is server-only and **fail-closed**. Without the live backend and the
credentials for the provider a given run selects, data and execution paths
return `503` / `ProviderUnavailableError`. There is no mock path for agent
authoring or runs.

## What is actually reachable today

The console at `/admin` is **rebuilt and active** — six live screens:

| Route | Screen |
|---|---|
| `/admin` | Overview — fleet KPIs, run trend, per-agent activity |
| `/admin/runs` | Runs — live run stream, filters, metrics |
| `/admin/agents` | Agents — catalogue with executable / degraded status |
| `/admin/agents/[id]` | Agent detail (read-only) |
| `/admin/projects` | Projects |
| `/admin/projects/[id]/builder` | Project builder — conversational authoring, SSE-streamed |

Plus the marketing site at `/`, `/about`, `/pricing`, `/contact`.

**Read this honestly:** the console is a *read* console. The project builder is
its only write surface. The rest of the lifecycle — qualification, promotion,
improvement, shipping, shadow, replay, tests, benchmarks — is real, tested HTTP
under `/api/agent-ops/**`, but **has no UI**. See
`docs/current-capabilities.md` for the row-by-row state and
`docs/known-gaps.md` §1 for what that costs.

Routes named in older documentation — `/admin/factory`, `/admin/performance`,
`/admin/settings`, `/admin/telemetry`, `/admin/agents/new` — **do not exist**.
`scripts/check-no-legacy-front.mjs` fails the build if any of them reappears, or
if a `/admin-v2` route shows up.

## Notable partial capabilities

State the restriction, not the headline:

- **Shipping to a consumer repo** is a **dry run** unless `confirm: true` is in
  the request body **and** `GITHUB_PUSH_ENABLED=1` is in the environment.
- **Telemetry** is read by the console (per-agent summary in the improvement loop
  and on `/admin/agents/[id]`, fleet summary + health diagnostic in the `/admin`
  Telemetry card). The remainders: `listRecentRuntimeTelemetryEvents` has no
  production caller, and **no externally deployed agent has ever reported** — all
  37 stored events are Aigent's own runs and lifecycle events.
- **Tool builder** works, but only `count_words` has a sandbox.
- **Provider `mistral`** is declared and **not wired** — it throws a typed error
  rather than falling back silently.
- **Provider `local`** (vLLM) requires an explicit opt-in key.

## Stack

- **Next.js 16** App Router — ⚠️ breaking changes vs. older Next; read
  `node_modules/next/dist/docs/` before touching framework code (`AGENTS.md`).
- **React 19**, TypeScript, Tailwind v4, Catalyst primitives (`src/components/ui/`).
- **LangGraph** — the `agent_builder` graph in `src/langgraph/`, served by the
  official LangGraph Agent Server. Mandatory runtime for every agent.
- **Direct model-router** (`src/lib/agent-mission-control/model-router.ts`) —
  per-copilot provider, routing to OpenAI / Gemini / local vLLM.
- **Postgres via PostgREST** — the `aigent` perimeter on GPU1, service-role,
  server-only. See `docs/BACKEND-GPU1.md`.

## Getting started

```bash
cp .env.example .env.local   # fill in real values; never commit this file
npm run dev
```

Runs both servers together:

- **Next.js → http://localhost:3987** — console at `/admin`.
  **Never port 3000. Never port 3210.** Other Next servers on this machine own
  both — 3000 always, and 3210 since `hearst-connect-v1-green-lab` took it on
  2026-07-30. Do not start Aigent there, do not kill what is listening there, and
  do not read it as if it were Aigent. Absolute rule, stated in full in
  `AGENTS.md` § "Port de dev".
- **LangGraph Agent Server → http://127.0.0.1:2024** — serves `agent_builder`;
  the same endpoint LangSmith Studio connects to.

Either alone: `npm run dev:next` / `npm run langgraph`. Studio:
`npm run langgraph:studio`.

Required env: `AMC_DATA_SOURCE=gpu1`, `AMC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `AMC_SESSION_SECRET`, `OPENAI_API_KEY`. See
`.env.example` for the full list. Without them the relevant paths fail closed.

After a clone, arm the secret hook once: `npm run hooks:install` (see
`CLAUDE.md`).

## Checks

```bash
npm run check      # full static gate — see docs/current-capabilities.md for the list
npm run verify     # check + knip + offline unit tests + build  (the release gate)
npm run typecheck
npm run lint
npm run test       # vitest, offline unit suite
npm run test:live  # opt-in — hits gpu1 + OpenAI, costs money, never in verify
```

A red gate beats any sentence in any `.md`. That precedence is stated once, in
`AGENTS.md`.

### One-shot proofs

```bash
npm run prove:factory-core        # deterministic, no network
npm run prove:factory-e2e         # full factory chain (needs gpu1 + LangGraph)
npm run prove:shadow-replay
npm run prove:autonomous-factory
```

### SonarQube

```bash
SONAR_TOKEN=<token> npm run sonar
```

Dashboard: http://100.88.191.49:9010/dashboard?id=agent-mission-control (Tailscale).

## Where the rules live

One rule, one file — nothing is restated:

- **`CLAUDE.md`** — git, branching, push, deployment, secrets.
- **`AGENTS.md`** — technical invariants: port, runtime, LangGraph, design
  tokens, doctrine hierarchy.
- **`docs/metrics-canon.md`** — how a number is allowed to be displayed.
- **`docs/agent-authoring.md`** — the authoring flow and the two execution paths.
- **`docs/BACKEND-GPU1.md`** — the Postgres/PostgREST perimeter.
- **`docs/TESTING.md`**, **`docs/dev-runtime.md`** — test and runtime specifics.
