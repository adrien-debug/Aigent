# Architecture — how Aigent is put together

> Structural map. What each layer is and where its boundary is. Capability
> states live in `docs/current-capabilities.md`; runtime invariants live in
> `AGENTS.md`.

## Layers

```
browser
  │
  ├── /                  marketing site        src/app/(site)/
  └── /admin/**          console (session-gated)
        │
        ▼
   src/proxy.ts          identity gate — fail-closed
        │
        ├── /admin/**            valid admin session cookie required
        └── /api/agent-ops/**    session cookie OR x-amc-key
        │
        ▼
   src/app/api/**        route handlers — the ONLY write points
        │
        ▼
   src/lib/**            data layer, runner, model router, tools  (server-only)
        │
        ├──► PostgREST ──► Postgres `aigent` on GPU1
        └──► LangGraph Agent Server (127.0.0.1:2024 in dev)
```

## Trust boundaries — there are three, deliberately separate

| Surface | Who | Credential |
|---|---|---|
| `/admin/**` | a human operator | HMAC-signed session cookie (`src/lib/agent-mission-control/auth.ts`) |
| `/api/agent-ops/**` | operator or Aigent's own automation | session cookie **or** `x-amc-key` |
| `/api/runtime-telemetry` | an agent deployed in a **consumer** repo | its own bearer token, `AIGENT_RUNTIME_TELEMETRY_TOKEN` — never `AMC_API_KEY` |
| `/api/runtime/v1/**` | a consumer product reading its agents | bearer token (`bearer-token-auth.ts`) |

The telemetry endpoint is mounted **outside** `/api/agent-ops/**` on purpose: a
consumer's deployed handler is a narrower, less-trusted caller than an operator,
so it gets its own token and its own gate. Its payload is treated as
attacker-controlled end to end — 16 KB cap, strict Zod shape, secret-pattern
scan, and nothing is echoed back, not even on error.

Local dev has one escape hatch: `AMC_DEV_BYPASS_AUTH=1` with
`NODE_ENV !== 'production'` skips the session gate on `/admin/**` pages only.
It cannot affect a production build and never bypasses the data API.

## Directory map

| Path | What |
|---|---|
| `src/app/(site)/` | Marketing site — Tailwind Plus blocks restyled on project tokens. |
| `src/app/admin/` | Console routes (6 pages + layout + error boundary). |
| `src/app/api/agent-ops/` | Operator/automation API — ~60 route handlers. |
| `src/app/api/runtime/v1/` | Consumer-facing runtime API (7 routes). |
| `src/app/api/runtime-telemetry/` | Telemetry ingestion from deployed agents. |
| `src/components/console/` | Console screens + `console-shell.tsx` + `charts/`. |
| `src/components/ui/` | Vendored Catalyst primitives — only what a live route consumes. |
| `src/components/marketing/` | Marketing-only components. |
| `src/lib/agent-mission-control/` | Data layer, runner, model router, tools, lifecycle. All `server-only`. |
| `src/lib/agent-mission-control/registry/` | Canonical runtime + tool registry — the authority. |
| `src/lib/runs-console/` | Runs page data, filters, metrics. |
| `src/langgraph/` | The `agent_builder` `StateGraph`, tool registry, own PostgREST client. |
| `supabase/migrations/` | 40 migrations for the `aigent` perimeter. |
| `scripts/` | Gates (`check-*.mjs`), provisioning, one-shot proofs (`scripts/archive/`). |
| `deploy/` | Container/Caddy config: `app/`, `db/` (PostgREST), `langgraph/`. |
| `tests/unit/` | Offline suite (part of `verify`). |
| `tests/live/` | Opt-in suite — hits GPU1 + OpenAI, costs money, never in `verify`. |

## Two execution paths, one contract

1. **LangGraph Agent Server** — the mandatory runtime for every agent
   (`runtime: 'langgraph'`). Human-in-the-loop: a confirmation-required tool
   pauses the graph, the run persists as `needs-confirmation`, and a dedicated
   resume route continues it.
2. **Direct model-router loop** (`model-router.ts`) — non-streamed, resolves the
   copilot's own provider per-copilot (`model_provider`), not globally.

Both mount the copilot's scoped executable tools from the same canonical
registry. The provider set and its wiring state are in
`docs/current-capabilities.md`; the LangGraph assistant trap is in `AGENTS.md`.

## Data

Postgres `aigent` on GPU1, reached over **PostgREST** with a service-role key,
server-side only. RLS is deny-by-default. There is **no mock data source** for
authoring or runs — without the backend and the selected provider's credentials,
those paths return `503` / `ProviderUnavailableError`. See `docs/BACKEND-GPU1.md`.

## Front end

Next.js 16 App Router (breaking changes vs. older Next — read
`node_modules/next/dist/docs/` first), React 19, TypeScript, Tailwind v4,
Catalyst primitives. Single typeface: Satoshi Variable, for everything —
`--font-sans` and `--font-mono` both resolve to it (`src/theme.css`), so a
`font-mono` class is a `tabular-nums` alignment choice, not a family change.

Console screens are server components by default. `agents-screen`,
`project-builder-screen` and `runs-screen` are client components; `overview-screen`,
`projects-screen` and `agent-detail-screen` stay on the server.

Visual tokens live in `src/theme.css` as the **current** console starting point;
this workspace is free design (see `AGENTS.md`) — no mandated palette or kit.
