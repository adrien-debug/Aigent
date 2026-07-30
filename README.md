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

## Frontend reset (état courant)

**Mission `frontend-reset` : le front historique a été entièrement supprimé.**

| État | Détail |
|---|---|
| UI | Une seule page racine : texte technique `Frontend reset complete` |
| Console `/admin` | **Absente** — pas de dashboard, pas de navigation |
| Marketing `(site)/` | **Absent** |
| `src/components/` | **Absent** — aucun design system, aucun kit UI |
| API | **Active** — `src/app/api/**` intact |
| Backend | **Intact** — `src/lib/**`, LangGraph, migrations, auth API |

La reconstruction UI viendra via blocs fournis séparément. La gate
`npm run check:no-legacy-front` refuse toute réapparition de
`src/components/`, `/admin`, `design/`, etc.

## Notable partial capabilities

State the restriction, not the headline:

- **Shipping to a consumer repo** is a **dry run** unless `confirm: true` is in
  the request body **and** `GITHUB_PUSH_ENABLED=1` is in the environment.
- **Telemetry** is aggregated in `dashboard-overview.ts` and `agent-detail.ts`
  — **no UI** until the front is rebuilt.
- **Tool builder** works, but only `count_words` has a sandbox.
- **Provider `mistral`** is declared and **not wired** — it throws a typed error
  rather than falling back silently.
- **Provider `local`** (vLLM) requires an explicit opt-in key.

## Stack

- **Next.js 16** App Router — ⚠️ breaking changes vs. older Next; read
  `node_modules/next/dist/docs/` before touching framework code (`AGENTS.md`).
- **React 19**, TypeScript — minimal App Router shell only (no Tailwind, no UI kit).
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

- **Next.js → http://localhost:3987** — placeholder root page only after frontend reset.
  **Never port 3000. Never port 3210.** See `AGENTS.md` § "Port de dev".
- **LangGraph Agent Server → http://127.0.0.1:2024** — serves `agent_builder`.

Either alone: `npm run dev:next` / `npm run langgraph`. Studio:
`npm run langgraph:studio`.

Required env: `AMC_DATA_SOURCE=gpu1`, `AMC_SUPABASE_URL`,
`SUPABASE_SERVICE_ROLE_KEY`, `AMC_SESSION_SECRET`, `OPENAI_API_KEY`. See
`.env.example` for the full list.

After a clone, arm the secret hook once: `npm run hooks:install` (see `CLAUDE.md`).

## Checks

```bash
npm run check      # full static gate — see docs/current-capabilities.md
npm run verify     # check + knip + unit tests + build
npm run typecheck
npm run lint
npm run test
npm run test:live  # opt-in — hits gpu1 + OpenAI, costs money
```

A red gate beats any sentence in any `.md`. That precedence is stated in `AGENTS.md`.

## Where the rules live

**Governance is 100 % local.** `CLAUDE.md` + `AGENTS.md` + the gates declared in
`package.json` are the complete set of rules for this project. No remote
repository, no external doctrine, no plugin, no governance SHA and no sync
command is needed to work on Aigent — you can understand and develop it offline
from this repository alone.

- **`CLAUDE.md`** — autonomy, when to ask, git and `mission/*` branches, secrets,
  destructive actions, proportionate validation, deployment.
- **`AGENTS.md`** — technical invariants: port, runtime, LangGraph, trust
  boundaries, data truth, frontend-reset guard.
- **`docs/metrics-canon.md`** — how a number is allowed to be displayed.
- **`docs/agent-authoring.md`** — authoring flow and execution paths.
- **`docs/BACKEND-GPU1.md`** — Postgres/PostgREST perimeter.
- **`docs/TESTING.md`**, **`docs/dev-runtime.md`** — test and runtime specifics.
