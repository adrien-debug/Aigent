# Current capabilities — verified state

> Established by reading the code at the SHA this file was committed on. Each
> row's **proof** column names a file you can open. A capability with no proof
> file does not belong in this table.
>
> **States** — `wired` (reachable from the console by an operator) ·
> `partial` (works but with a named restriction) · `backend-only` (the HTTP
> route or library exists and is tested, but no console surface reaches it) ·
> `not wired` (declared in code, throws or does nothing).
>
> The distinction that matters most here is **wired vs backend-only**. The
> console rebuilt in the current cycle is a *read* console plus exactly one
> write surface (the project builder). Nearly the whole lifecycle chain is
> real, tested, and reachable only by an HTTP call — not by a click.

## Console (operator-reachable)

| Capability | State | Proof |
|---|---|---|
| Overview screen — fleet KPIs, run trend, per-agent activity | wired | `src/app/admin/page.tsx`, `src/components/console/overview-screen.tsx` |
| Runs screen — live run stream, filters, metrics | wired | `src/app/admin/runs/page.tsx`, `src/lib/runs-console/runs-page-data.ts` |
| Agents list — catalogue with executable / degraded status | wired | `src/app/admin/agents/page.tsx`, `src/lib/agent-mission-control/available-agents.ts` |
| Agent detail | wired (read-only) | `src/app/admin/agents/[id]/page.tsx`, `src/components/console/agent-detail-screen.tsx` |
| Agent detail — governed lifecycle trace (draft → … → V2 draft), each stage sourced independently | wired (read-only) | `src/lib/agent-mission-control/agent-lifecycle-trace.ts`, `src/components/console/lifecycle-trace-panel.tsx`; `active_in_consumer` is always `unknown` by design (no consumer-side read channel); telemetry leg fail-soft |
| Projects list | wired | `src/app/admin/projects/page.tsx` |
| Project builder — conversational agent authoring, SSE-streamed | wired | `src/app/admin/projects/[id]/builder/page.tsx`, `src/components/console/project-builder-screen.tsx` |
| Console shell — rail, topbar, degraded-state indicator | wired | `src/components/console/console-shell.tsx` |
| Marketing site (`/`, `/about`, `/pricing`, `/contact`) | wired | `src/app/(site)/` |
| Login | wired | `src/app/api/auth/login/route.ts`, `src/proxy.ts` |

The rail carries exactly four entries: Overview, Runs, Projects, Agents. The
builder is reached from the Projects screen because it needs a project id.
`Factory`, `Performance`, `Settings`, `Telemetry` are **deleted routes** —
`scripts/check-no-legacy-front.mjs` fails the build if any reappears.

## Authoring & lifecycle

| Capability | State | Proof |
|---|---|---|
| Architect flow — NL description → structured manifest | backend-only | `src/app/api/agent-ops/architect/route.ts`, `architect-prompt.ts` |
| Agent drafts persistence | backend-only | `src/app/api/agent-ops/agent-drafts/[draftId]/route.ts`, `agent-drafts-store.ts` |
| Real agent run (direct model-router path) | backend-only | `src/app/api/agent-ops/copilots/[copilotId]/run/route.ts`, `runner.ts` |
| Execution guard — fail-closed, only `active` + all tools resolved may run | backend-only | `copilots/[copilotId]/run/route.ts` |
| Human-in-the-loop interrupt / resume | backend-only | `copilots/[copilotId]/runs/[runId]/resume/route.ts` |
| Test suite generation + run | backend-only | `tests/generate/route.ts`, `tests/run/route.ts`, `agent-suite-generator.ts` |
| Benchmarks (single + sweep) | backend-only | `benchmarks/run/route.ts`, `benchmarks/sweep/route.ts` |
| Shadow experiment | backend-only | `versions/[versionId]/shadow/route.ts`, `shadow-live.ts` |
| Replay comparison | backend-only | `versions/[versionId]/replay/route.ts`, `replay-live.ts` |
| Release gate (9 checks) | backend-only | `release-gate.ts`, `promotion-gate.ts` |
| Qualification orchestrator (tests → benchmark → shadow → replay → gate) | backend-only | `qualification-orchestrator.ts`, `copilots/[copilotId]/qualification/route.ts` |
| Promotion to `active` | backend-only | `copilots/[copilotId]/promotion/route.ts` |
| Improvement loop — analyze / create-v2 / decision | backend-only | `improve/analyze`, `improve/create-v2`, `improve/decision` routes, `improvement-loop.ts` |
| Target-repo sandbox | backend-only | `target-sandbox/route.ts`, `target-repo-sandbox-runner.ts` |

None of these have a button. Every one is exercised by `tests/unit/**` and by
the archived one-shot proofs (`npm run prove:*`).

## Shipping to consumer products

| Capability | State | Proof |
|---|---|---|
| Consumer workspace provisioning (intake pack into the linked repo) | backend-only | `projects/[id]/provision-consumer/route.ts`, `consumer-bootstrap.ts` |
| Push agent artifacts to the consumer repo | partial — dry-run unless `GITHUB_PUSH_ENABLED=1` **and** `confirm: true` | `projects/[id]/push-agent/route.ts`, `github.ts:54` |
| Push as a pull request | partial — same two flags | `github.ts` `pushAgentToRepoPullRequest` |
| Repo scan / repo intelligence | backend-only | `projects/[id]/repo/scan`, `repo/intelligence`, `repo-intelligence.ts` |
| Delivery loop + delivery scorecard | backend-only | `copilots/[copilotId]/delivery-loop/route.ts`, `delivery-scorecard-server.ts` |
| Runtime API v1 — consumer reads its agents and posts runs | backend-only | `src/app/api/runtime/v1/**` (7 routes), `runtime-catalogue.ts` |

## Telemetry

| Capability | State | Proof |
|---|---|---|
| Ingestion endpoint for consumer-deployed handlers | backend-only, own bearer token (`AIGENT_RUNTIME_TELEMETRY_TOKEN`), size-capped and shape-validated | `src/app/api/runtime-telemetry/route.ts` |
| Aigent's own internal runs fed into the same table | wired (automatic) | `runner.ts:643`, `emitInternalRunTelemetry` |
| Lifecycle telemetry (promotion / shadow / replay) on the same channel | wired (automatic) | `runtime-telemetry-store.ts` `emitPromotionTelemetry` / `emitShadowTelemetry` / `emitReplayTelemetry` |
| Per-agent telemetry summary consumed by the improvement loop | backend-only | `improvement-loop.ts:56` → `summarizeRuntimeTelemetry` |
| Fleet telemetry summary | wired — `summarizeFleetRuntimeTelemetry` feeds the `/admin` Telemetry card | `dashboard-overview.ts:22,936` → `overview-screen.tsx:856` |
| **Recent-events feed** | wired — `listRecentRuntimeTelemetryEvents(50)` on `/admin` Overview | `dashboard-overview.ts` → `overview-screen.tsx` |
| Telemetry health diagnostic | wired — `diagnoseTelemetryHealth` renders as the Telemetry card's channel status | `dashboard-overview.ts:21,948` → `overview-screen.tsx:858` |

**What telemetry still lacks.** The consumer return channel is built and
authenticated but has never carried real traffic from an externally deployed
agent (measured 2026-07-30) — every stored row is Aigent's own runner or a
lifecycle event.

## Runtime & providers

| Capability | State | Proof |
|---|---|---|
| LangGraph `agent_builder` graph on the official Agent Server | wired | `src/langgraph/`, `langgraph.json` |
| Direct model-router loop | wired | `model-router.ts` |
| Provider `openai` | wired | `model-router.ts` |
| Provider `google` / Gemini | wired | `model-router.ts`, `src/langgraph/model-provider.mjs` |
| Provider `local` (vLLM, OpenAI-compatible) | partial — explicit opt-in, `VLLM_LOCAL_API_KEY` | `model-local.ts` |
| Provider `mistral` | **not wired** — throws a typed error, never a silent fallback | `src/langgraph/model-provider.mjs:86` |
| Tool registry + canonical tool definitions | wired | `src/lib/agent-mission-control/registry/`, `tool-handlers.ts` |
| Market tools (trading, read-only) | wired | `market/`, `api/agent-ops/market-tools/[toolName]/route.ts` |
| Real-estate tools | wired | `realestate/`, `api/agent-ops/realestate-tools/[toolName]/route.ts` |
| Tool builder | partial — only `count_words` has a sandbox | `tool-builder/`, `api/agent-ops/tool-build-missions/route.ts` |
| Langfuse / LangSmith observability hooks | backend-only | `langfuse.ts`, `langsmith.ts` |

## Gates (the arbiter)

`npm run check` runs, in order: `typecheck` · `lint:fast` (oxlint) · `lint` ·
`check:no-legacy-front` · `check:agent-truth` · `check:render-truth` ·
`check:status-truth` · `check:lifecycle-truth` · `check:registry-parity` ·
`check:registry-integrity` · `check:tool-rows` · `check:tool-definitions` ·
`check:rsc-boundary` · `check:secrets` (gitleaks) · `audit:dead`.

`check:lifecycle-truth` (`scripts/check-lifecycle-truth.mjs`) is narrow by
design — it names two files (`agent-lifecycle-trace.ts`,
`lifecycle-trace-panel.tsx`) rather than walking a directory, and blocks five
specific claims: "deployed" without consumer proof, "healthy" without a real
`diagnoseTelemetryHealth` call, a telemetry value coalesced to a false zero,
"promoted" disconnected from a production-stage check, and the
`active_in_consumer` stage computed from anything other than the literal
`'unknown'`.

`npm run verify` adds `quality:dead` (knip), `test` (vitest, offline unit suite)
and `build`. `test:live` is opt-in, hits GPU1 + OpenAI, costs money, and is
never part of `verify`.

Gates named in older docs — `check:ds`, `check:contrast`, `check:catalyst`,
`check:danger`, `check:views` — **no longer exist**; they were removed with the
old dashboard and were never re-added for the current console.
