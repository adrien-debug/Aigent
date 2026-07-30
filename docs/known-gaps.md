# Known gaps — what is honestly missing

> Companion to `docs/current-capabilities.md`. That file says what state each
> capability is in; this one says why the gap matters and what closing it means.
> Nothing here is speculation — every gap was established by reading the code.

## 1. ~~The console is a read console.~~ CLOSED — the lifecycle has buttons.

This gap was real when written and is no longer true. The console rebuild
(`984c5d6`..`644eada`) gave the lifecycle a UI, but this file was not updated in
the same pass — it kept claiming the opposite for a week.

Measured 2026-07-30 with
`grep -rhoE "/api/agent-ops/[^\`'\" ]+" src/components/console/*.tsx | sed 's/\${[^}]*}/:id/g' | sort -u`:
**15 distinct endpoints across 5 components**, not three. Run, tests/run,
benchmarks/run, qualification, promotion, shadow, replay, improve (analyze /
create-v2 / decision), delivery-loop and push-agent are all driven from
`qualification-panel.tsx`, `improve-panel.tsx`, `delivery-controls.tsx`,
`agent-actions.tsx` and `project-builder-screen.tsx`.

What genuinely remains: bench-only architect runs started via
`POST /api/agent-ops/architect/run` (no `projectId`) still have no DB row —
only project-builder conversations are listed on Overview. See §7 for HITL runs
whose tab was closed: they are now reachable from the Overview action queue when
the conversation still holds a live `langgraph_thread_id`.

## 2. Telemetry comes back — the fleet view exists, one reader does not.

Ingestion is solid — dedicated token, hardened payload handling, a table that
holds both consumer-reported runs and Aigent's own. Of the data going in:

- `summarizeRuntimeTelemetry` (per-agent) is read by the improvement loop and by
  `agent-detail.ts` for `/admin/agents/[id]`. ✅
- `summarizeFleetRuntimeTelemetry` and `diagnoseTelemetryHealth`
  (`telemetry-health.ts`) are called by `dashboard-overview.ts` and rendered as
  the Telemetry card on `/admin`. ✅ — this file previously claimed both had zero
  callers, which was wrong.
- `listRecentRuntimeTelemetryEvents` is now read by `/admin` (Overview telemetry
  panel, bounded to 50 events). ✅
- The per-event stream is no longer a dead export — it is surfaced on the
  flagship screen alongside the fleet channel KPIs.

The honest gap is narrower than it was: fleet health and the per-event feed are
visible on Overview. Note also that of 37 rows in `runtime_telemetry_events`, **zero
came from an externally deployed agent** — every row is Aigent's own runner or a
lifecycle event, so the return channel has never been exercised end to end.

## 3. Shipping is double-gated off by default.

`push-agent` writes to a real GitHub repo only when **both** `confirm: true` is
in the body and `GITHUB_PUSH_ENABLED=1` is in the environment. Otherwise it is a
dry run. That is the correct default for a destructive remote write — but it
means the shipping leg of the loop is not exercised in normal operation, and
"Aigent ships agents" is a claim about a path that is off unless someone turns
it on deliberately.

## 4. The tool builder builds one tool.

`count_words` is the only tool with a sandbox. The build-mission machinery
(`tool_build_missions`, migration `0043`) is general; the sandbox coverage is not.

## 5. `mistral` is declared and not wired.

It throws a typed error rather than falling back silently — which is the right
failure — but any doc or config that lists it as a provider option is listing
something that cannot run.

## 5bis. Version drift cannot be computed yet — the delivery event lacks a resolvable version.

The lifecycle trace (`agent-lifecycle-trace.ts`) is meant to compare the last
DELIVERED version against the last version self-reported by telemetry and flag
a mismatch. It cannot, today: `DeliveryEvent`'s read shape
(`delivery-events-store.ts`) does not carry `versionId` — only the write input
does — so there is no join from a delivery row back to a version label. The
trace reports this honestly as `versionDrift.state: 'unknown'` with a detail
string naming the gap, rather than guessing a match. Closing this needs either
adding `version_id` to the `agent_delivery_events` SELECT and the read type, or
persisting a version label directly on the row.

## 5ter. "Active in consumer" is permanently unknown by design, not by gap.

Unlike the drift gap above, this one is not a TODO: `agent-lifecycle-trace.ts`
hard-codes the `active_in_consumer` stage to `reached: 'unknown'` because
Aigent has no read channel into a consumer workspace's own activation state
(AGENTS.md: "Après provisioning, Aigent ne fait que POUSSER des agents").
`scripts/check-lifecycle-truth.mjs` enforces that this stays the literal
`'unknown'` and is never inferred from a delivery event. Building a real
answer here requires a genuine consumer-side read channel — a product
decision, not a data-plumbing fix.

## 6. Documentation drift is a recurring failure mode here.

Before this pass, `CLAUDE.md` and `AGENTS.md` both asserted that `/admin` and
`/admin/runs` were neutral placeholders and that visual reconstruction had not
begun, while `src/app/admin/` held six live screens and ~4 600 lines of console
components. `README.md` documented `/admin/factory`, `/admin/performance` and
`/admin/agents/new` — three routes that the build gate now actively forbids.

There is no gate that checks a doc against the code. Until there is, this file
and `docs/current-capabilities.md` are only as fresh as the last person who read
the source.

## 7. ~~Visual doctrine is thin.~~ NOT A GAP — this workspace is free design.

Previously listed here as a hole: no `check:ds` / `check:contrast` /
`check:catalyst` / `check:danger` / `check:views`. That absence is now the
DECISION, not an omission. This workspace carries no design doctrine and no
visual gate: no mandated palette, kit, font or token layer. What lives in
`src/theme.css` and `src/components/ui/` is a starting point anyone may keep,
bend or replace.

What still holds is not design: `check:render-truth` / `check:status-truth`
(a screen may only claim what was measured) and `check:no-legacy-front`
(deleted routes stay deleted). Those are honesty and structure.

Do not re-file this as a gap, and do not "restore" a design gate here.

## Not verified in this pass

- Whether the live GPU1 backend currently holds the canonical TradeAgent roster
  in the documented state. That needs a live read; nothing here was run against
  the database.
- Whether the deployed consumer products are in fact emitting telemetry. The
  endpoint accepts it; whether anything calls it in production was not checked.
- Runtime behaviour of any kind. This pass read source only — no server was
  started, no test suite was run.
