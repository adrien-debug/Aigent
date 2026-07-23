# Aigent landing — self-improving positioning rework

PR: [#15](https://github.com/adrien-debug/Aigent/pull/15) — branch `feat/landing-self-improving-positioning`.

## What was kept

- Hero structure and CTAs ("Open the console" / "View pricing").
- The "Run with confidence" feature section (copilot manifests, real runs, human-in-the-loop).
- The "Built in" capabilities strip, the CTA section, footer, pricing, and contact page — unchanged.
- `ConsolePreview` (the existing decorative dashboard mockup) stays as the hero illustration.

## What was added

- **Self-improving section** ("The loop that makes every agent better" / "Analyze, propose, compare, decide") with `ImproveLoopPreview` — a decorative, `aria-hidden` illustration of the five-step flow (Analyze → Propose → Create V2 → Compare → Decide). Vertical layout on mobile, five columns from `lg` up.
- **Multi-agent section** ("Beyond a single agent" / "Orchestrate specialized agents as one team") with `TeamCanvasPreview` — a decorative, `aria-hidden` illustration approximating the real per-project team graph's node/edge model (project node, one visually distinct orchestrator, three team members, connecting lines).
- `platformFeatures`: multi-agent teams, per-agent model routing (OpenAI/Gemini/local model infrastructure), tool registry, test suites.
- About page: three untimed "principles in practice" cards (manifests, benchmarks/shadow mode, human-in-the-loop) replacing the dated timeline.

## What was removed

- The dated About timeline (`Year 1` / `Year 2`, `2024-01` through `2025-09`) — see "About timeline" below.
- The About hero's "someone had to watch an unattended agent make a call it shouldn't have" anecdote — implied a specific past incident with no evidence behind it; replaced with a direct statement of what Aigent is being built to do.
- `secondaryFeatures`'s prior "GitHub-native" bullet duplicated content now under `platformFeatures`; trimmed to benchmark suites + staged promotion, which is what that section's illustration actually supports.

## Product claims verified against the running instance

Checked live on the already-running local instance (port 3210, Adrien's session — never stopped, never restarted) before writing any landing copy. Screenshots in `docs/product-audit/aigent/`:

- **Agent creation, benchmarking, run history** — `dashboard-overview.png`, `fleet-performance.png`: real dashboard, 16 runs/24h, per-agent pass rates and cost.
- **Agent roster, multi-provider routing** — `agents-roster.png`: 4 TradeAgent copilots, LangGraph runtime, `gpt-5.4 · openai` shown per agent (confirms the model-router supports OpenAI; Gemini and local vLLM routing are in the code path per `docs/agent-authoring.md` §1, not independently re-verified against a live non-OpenAI run in this session).
- **Projects tied to real repos** — `projects-list.png`: TradeAgent, Real Estate Agent, Hearst-Defi, Netpool, etc., each linked to a GitHub repo.
- **Improvement loop** — the analyze → propose → create-v2 → compare → decide flow described in `docs/agent-authoring.md` §1c and implemented in `src/lib/agent-mission-control/improvement-loop.ts`; not exercised live in this session (no failing run was available to trigger `improve/analyze` against), so `ImproveLoopPreview` is illustrative, not a captured screenshot.

## Multi-agent team canvas — exact situation

Two screenshots exist in `docs/product-audit/aigent/` and were taken from the real instance:

- `team-canvas-empty-initial-load.png` — the `/admin/projects/proj-tradeagent/team` page on first load: header stats correct (4 agents, 25 runs today), but the graph area is empty.
- `team-canvas-empty-refresh-failed.png` — same page after clicking "Fit view": still empty, with the page itself stating **"Refreshed 23s ago · last refresh failed, showing the previous graph."**

Browser console on that page showed repeated `401 Unauthorized` on `GET /api/agent-ops/projects/proj-tradeagent/team`. Neither screenshot shows a usable graph — both are evidence of a failed data fetch, not the canvas itself. **Neither was usable in the landing.** `TeamCanvasPreview` is a hand-built illustration based on the documented node/edge model (`docs/project-team-canvas.md`): orchestrator vs. team member, project→agent and orchestrator→member relations. No node name, count, or status in the illustration is presented as live data — the section's visible paragraph carries the same claim in words, independent of whether the illustration renders.

## Runtime telemetry — exact situation

`docs/product-audit/aigent/runtime-telemetry-unconfigured.png`: `/admin/telemetry` states **"Telemetry ingestion is not configured"** — `AIGENT_RUNTIME_TELEMETRY_TOKEN` unset, `/api/runtime-telemetry` returns 503. This is runtime telemetry for *delivered* agents running in an external environment, distinct from the internal run/benchmark telemetry the Dashboard and Performance pages already show and that is real (16 runs, per-agent pass rates, live cost).

Decision: **omission**. The landing does not mention runtime telemetry for deployed agents anywhere. The internal run/benchmark tracking is described only through what is already true and shown (benchmark suites, real runs — not the word "telemetry").

## About page timeline — investigated, not assumed

`git log --reverse --format=%ad --date=short | head -1` on this repository returns **2026-07-09** — the entire history is two weeks old at the time of this rework. The removed timeline claimed events in `2024-01` through `2025-09`, roughly a year before the repository existed. This is the "dates are false / template" case: the timeline was removed and replaced with three untimed cards describing the same real capabilities (manifests, benchmarks/shadow mode, human-in-the-loop) without inventing a history. The About hero was similarly reworded to state what Aigent is being built to do, in the present, rather than narrate a specific past incident with no supporting evidence.

## Validation

- `npm run verify`: **PASS** — typecheck, lint, `check:ds`, `check:catalyst`, `check:agent-truth`, `check:danger`, `check:render-truth`, `check:status-truth`, `check:registry-parity`, `audit:dead`, 1215 unit tests (102 files), `next build`.
- `git diff --check`: clean.
- A repo-wide search for the banned term, restricted to files changed by this PR: **zero occurrences.**
- Browser QA on the built output (`next start` on port 3299, separate from Adrien's port-3210 dev instance): desktop 1440×900, laptop 1280×800, mobile 375×812 and 390×844 — zero console errors on every viewport, no layout overlap, no truncated text observed.

## Screenshots in this folder

| File | Content |
| --- | --- |
| `desktop-1440x900.png` | Full landing page, desktop |
| `laptop-1280x800.png` | Full landing page, laptop |
| `mobile-375x812.png` | Full landing page, mobile |
| `self-improving-section.png` | Self-improving section detail, desktop |
| `multi-agent-section.png` | Multi-agent section detail, desktop |

See `manifest.json` for the exact commit SHA these were captured against.
