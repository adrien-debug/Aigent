# Agent Mission Control

Internal control plane for authoring, testing, promoting and running LLM
copilots. A Next.js 16 (App Router) admin console backed by a dedicated Postgres
perimeter (`aigent`) on GPU1, with real agent execution split between a direct
model-router loop and the official **LangGraph Agent Server** for
human-in-the-loop runs.

Everything here is server-only and **fail-closed**: without the live backend and
the credentials for the provider a given run selects (`OPENAI_API_KEY`, and/or
`GEMINI_API_KEY` / `VLLM_LOCAL_API_KEY` on the direct path), data and execution
paths return `503`/`ProviderUnavailableError` — there is no mock path for agent
authoring or runs.

## Stack

- **Next.js 16** App Router — ⚠️ this version has breaking changes vs. older
  Next; read `node_modules/next/dist/docs/` before touching framework code
  (see `AGENTS.md`).
- **React 19**, TypeScript, Tailwind v4, Catalyst UI kit (`src/components/catalyst/`).
- **LangGraph** (`@langchain/langgraph` + `@langchain/langgraph-sdk`) — the
  `agent_builder` graph in `src/langgraph/`, served by the LangGraph Agent Server.
  It resolves the copilot provider and mounts its scoped executable tools,
  including the seven read-only market tools through their canonical handlers.
- **Multi-provider on the direct path** — the direct model-router loop
  (`src/lib/agent-mission-control/model-router.ts`) resolves the copilot's
  provider and routes to **OpenAI** (`OPENAI_API_KEY`), **Gemini**
  (`GEMINI_API_KEY`/`GOOGLE_API_KEY`), or Adrien's **local vLLM** park
  (`VLLM_LOCAL_API_KEY`, OpenAI-compatible). Provider is per-copilot
  (`model_provider`), not global. The live catalog is the 4 TradeAgent
  copilots on `openai`/`gpt-5.4`.
- **Postgres via PostgREST** — the `aigent` perimeter on GPU1 (service-role,
  server-only). See `docs/BACKEND-GPU1.md`.

## Getting started

Copy the env template and fill in real values (never commit `.env.local`):

```bash
cp .env.example .env.local
```

Then run **both** servers together — the app and the LangGraph Agent Server:

```bash
npm run dev
```

- **Next.js** → http://localhost:3210 (admin console at `/admin`).
- **LangGraph Agent Server** → http://127.0.0.1:2024 (serves the `agent_builder`
  graph; the same endpoint LangSmith Studio connects to).

Run either alone with `npm run dev:next` / `npm run langgraph`, and open Studio
with `npm run langgraph:studio`.

### Required env

`AMC_DATA_SOURCE=gpu1`, `AMC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY` (see `.env.example` for the full list, including
`LANGGRAPH_API_URL`, `AGENT_BUILDER_MODEL`, `TRADEAGENT_MARKET_URL`, and
`TRADEAGENT_PORTFOLIO_RISK_URL` + `TRADEAGENT_INTERNAL_API_KEY` for live
market reads and portfolio risk). Without them the relevant data and run paths fail closed.

### TradeAgent roster (gpu1)

Reconcile the four canonical TradeAgent copilots on `proj-tradeagent` (migration 0033 lockdown: plain INSERT only, no upsert on `copilots` / `copilot_versions`):

```bash
node --env-file=.env.local scripts/provision-tradeagent-roster.mjs --apply
LANGGRAPH_API_URL=http://127.0.0.1:2024 npm run reprovision
LANGGRAPH_API_URL=http://127.0.0.1:2024 node --env-file=.env.local $(command -v npx) -y tsx --conditions=react-server scripts/prove-market-intelligence.ts
node --env-file=.env.local scripts/scorecard-tradeagent.mjs copilot-market-intelligence
LANGGRAPH_API_URL=http://127.0.0.1:2024 node --env-file=.env.local $(command -v npx) -y tsx --conditions=react-server scripts/promote-tradeagent-copilot.ts portfolio-risk-guardian
```

Agents are born `draft`; promotion to `active` goes through `/api/agent-ops/copilots/:id/promotion` after a passing gate.

**Tool catalogue** (`tool_definitions` + `tools.tool_definition_id`, migration `0041`): registry authority in code, shared DB rows per tool, per-copilot mounts FK to the catalogue. Sync and gate:

```bash
# After applying 0041 on gpu1:
npm run sync:tool-definitions
npm run check:tool-definitions        # SKIPs offline; arms with AMC_DATA_SOURCE=gpu1
npm run check:tool-definitions -- --fix
```

## Checks

```bash
npm run verify     # full release gate: typecheck + lint + check:ds + check:catalyst + unit tests + build
npm run check      # fast gate (no build/tests): typecheck + lint + check:ds + check:catalyst
npm run typecheck  # tsc --noEmit
npm run lint       # eslint
npm run check:ds   # monochrome-accent + zinc palette / contrast guard
npm run test       # vitest — offline unit suite (tests/unit/**)
npm run test:live  # vitest — LIVE suite (tests/live/**), opt-in, hits gpu1 + OpenAI, costs money
```

### SonarQube

Static analysis against the GPU1 SonarQube server (`agent-mission-control` project).
Local scan (Docker + `SONAR_TOKEN`):

```bash
SONAR_TOKEN=<token> npm run sonar
```

Dashboard: http://100.88.191.49:9010/dashboard?id=agent-mission-control (Tailscale).
CI runs the same scan on the org self-hosted runner `gpu1` (advisory, `continue-on-error`).

`npm run verify` is the release gate — it adds `next build` and the offline unit
suite on top of `check`. The live suite (`test:live`) is never part of `verify`:
it needs the real `npm run dev` stack + gpu1 PostgREST + OpenAI and self-skips
when unreachable.

The DS guard (`scripts/check-palette.mjs`) enforces the palette doctrine in
`src/components/agent-ops/DESIGN-DOCTRINE.md` — token-only colors, WCAG AA
contrast, no mock data in the app. It runs in CI and must stay green.

## Typography

**One typeface across the entire product — Satoshi Variable, for everything,
including KPIs and numbers.** The earlier rule that held numeric / tabular
values (KPI figures, IDs, versions, costs) in a monospace face (Geist Mono) has
been **removed**: every surface now reads in a single voice.

- The font is loaded once in `src/app/layout.tsx` (`--font-satoshi`, a local
  variable woff2). Geist Mono is no longer loaded.
- In `src/app/globals.css`, **both** Tailwind font slots resolve to it:
  `--font-sans: var(--font-satoshi)` and `--font-mono: var(--font-satoshi)`.
  So any `font-mono` class in the app (KPI values, tool names, SHAs, JSON, code)
  renders in Satoshi. `tabular-nums` is still used to keep figures aligned —
  it's a font-feature toggle, independent of the family.
- Doctrine: `src/components/agent-ops/DESIGN-DOCTRINE.md` → "Typo & espacement".

## Layout

| Path | What |
|---|---|
| `src/app/admin/` | Admin console — projects, agents, versions, tests, runs, settings. |
| `src/app/api/agent-ops/` | Server-only route handlers (the only OpenAI / Agent Server / write points). |
| `src/lib/agent-mission-control/` | Data layer, runner, model router, auth, tool handlers (all `server-only`). |
| `src/langgraph/` | The `agent_builder` `StateGraph`, tool registry, and its own PostgREST client. |
| `src/components/agent-ops/` | The console UI. |
| `src/components/catalyst/` | Vendored Catalyst UI kit. |
| `supabase/migrations/` | Schema for the `aigent` perimeter. |
| `scripts/` | `seed-amc.ts`, `provision-agent-builder.ts`, `provision-tradeagent-roster.mjs`, `reprovision-assistants.ts`, `check-palette.mjs`, `check-catalyst.mjs`. |
| `deploy/` | Container/Caddy config: `app/` (the Next.js app), `db/` (the data layer — PostgREST + Caddy over the `aigent` database), `langgraph/` (the Agent Server). |

## Docs

- **`docs/agent-authoring.md`** — how a copilot gets created (architect flow),
  the two execution paths (LangGraph vs. direct model-router), and the
  human-in-the-loop interrupt/resume lifecycle. Also covers the project
  builder — a full-screen **modal** (not a page), whose architect replies are
  **streamed over SSE** token-by-token — and the post-creation
  **improvement loop** (analyze → create-v2 → decision).
- **`docs/BACKEND-GPU1.md`** — the `aigent` Postgres/PostgREST perimeter on GPU1.
- **`AGENTS.md`** — Next.js 16 caveat for agents working in this repo.
