# Agent Mission Control

Internal control plane for authoring, testing, promoting and running LLM
copilots. A Next.js 16 (App Router) admin console backed by a dedicated Postgres
perimeter (`aigent`) on GPU1, with real agent execution split between a direct
OpenAI model-router loop and the official **LangGraph Agent Server** for
human-in-the-loop runs.

Everything here is server-only and **fail-closed**: without the live backend and
`OPENAI_API_KEY`, data and execution paths return `503` — there is no mock path
for agent authoring or runs.

## Stack

- **Next.js 16** App Router — ⚠️ this version has breaking changes vs. older
  Next; read `node_modules/next/dist/docs/` before touching framework code
  (see `AGENTS.md`).
- **React 19**, TypeScript, Tailwind v4, Catalyst UI kit (`src/components/catalyst/`).
- **LangGraph** (`@langchain/langgraph` + `@langchain/langgraph-sdk`) — the
  `agent_builder` graph in `src/langgraph/`, served by the LangGraph Agent Server.
- **OpenAI** — the only LLM provider (architect + runner + graph).
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

- **Next.js** → http://localhost:3000 (admin console at `/admin`).
- **LangGraph Agent Server** → http://127.0.0.1:2024 (serves the `agent_builder`
  graph; the same endpoint LangSmith Studio connects to).

Run either alone with `npm run dev:next` / `npm run langgraph`, and open Studio
with `npm run langgraph:studio`.

### Required env

`AMC_DATA_SOURCE=gpu1`, `AMC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`OPENAI_API_KEY` (see `.env.example` for the full list, including
`LANGGRAPH_API_URL` and `AGENT_BUILDER_MODEL`). Without them the data and run
paths fail closed with `503`.

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

`npm run verify` is the release gate — it adds `next build` and the offline unit
suite on top of `check`. The live suite (`test:live`) is never part of `verify`:
it needs the real `npm run dev` stack + gpu1 PostgREST + OpenAI and self-skips
when unreachable.

The DS guard (`scripts/check-palette.mjs`) enforces the palette doctrine in
`src/components/agent-ops/DESIGN-DOCTRINE.md` — token-only colors, WCAG AA
contrast, no mock data in the app. It runs in CI and must stay green.

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
| `scripts/` | `seed-amc.ts`, `provision-agent-builder.ts`, `check-palette.mjs`. |
| `deploy/` | Container/Caddy config for the app and the Agent Server. |

## Docs

- **`docs/agent-authoring.md`** — how a copilot gets created (architect flow),
  the two execution paths (LangGraph vs. direct model-router), and the
  human-in-the-loop interrupt/resume lifecycle.
- **`docs/BACKEND-GPU1.md`** — the `aigent` Postgres/PostgREST perimeter on GPU1.
- **`AGENTS.md`** — Next.js 16 caveat for agents working in this repo.
