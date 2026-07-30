# Runbook — Trading Agent Factory (AIG-TRADE-001)

Operational procedures for the six founder trading agents. Every LLM-billed step
is called out explicitly — **do not run those without Adrien's explicit approval**
(`CLAUDE.md` §3 « quand demander » et §5 « actions destructives »).

## 0. Prerequisites

- `TRADEAGENT_MARKET_URL` — base URL of a running TradeAgent instance, to read
  its public `/api/market/*` routes for LIVE/SNAPSHOT data. **Unset → tools
  return `UNAVAILABLE`** (no fabrication). Never point this at a write API.
- `OPENAI_API_KEY` + `AMC_DATA_SOURCE=gpu1` + Supabase env — required only for
  the **billed** materialization/benchmark/improvement steps.

## 1. Inspect the roster (free, no LLM)

The six agents are pure config in
`src/lib/agent-mission-control/market/agents/roster.ts`. There is no UI: the
frontend was reset and the only surface is the HTTP API. Nothing here calls a
model.

## 2. Run the deterministic test corpus (free, no LLM)

```
npm run test -- tests/unit/market-corpus.test.ts   # corpus meta-coherence
npm run test -- tests/unit/market-*.test.ts         # whole trading socle
```

These validate the socle (tools, contracts, indicators, corpus, benchmark
scoring, shadow, council, delivery) WITHOUT any OpenAI call.

## 3. Materialize the six agents as real copilots (💲 OpenAI-billed — needs approval)

This is the step that turns each roster entry into a real Aigent copilot via the
architect / `createCopilotFromManifest` path, producing V1 draft copilots on the
validation bench (`project_id: null`, `status: draft`). It consumes OpenAI
credits per agent. **Get explicit approval first.** Once approved:

1. For each `ROSTER` entry, drive the architect to emit its `GeneratedManifest`
   from the roster's `systemPromptSummary` + tools + output contract.
2. Persist as a draft copilot (never production).
3. Attach the trading tools + output contract.

## 4. Run tests + benchmarks per agent (💲 OpenAI-billed — needs approval)

For each materialized V1:

1. Run the behavioural + safety test suites (the corpus, executed against the
   real agent) — records real `agent_runs`.
2. Run the trading benchmark (`market/eval/benchmark.ts` dimensions).
3. Read the per-dimension scores + gate result. A blocked run → global 0.

Announce the run budget before starting; cap the number of calls; record cost +
model per run; distinguish LIVE from SNAPSHOT evidence.

## 5. Improvement loop V1 → V2 (💲 OpenAI-billed — needs approval)

Only if a real, bounded, explainable defect was found:

1. `improve/analyze` → strict-JSON manifest patch (behaviour fields only).
2. `improve/create-v2` → materialize a V2 draft.
3. Re-run the SAME locked suites/benchmarks pinned to V2.
4. `compareVersions(v1, v2)` — reject V2 on any critical regression, increased
   hallucination, masked UNAVAILABLE, over-fit, or excessive cost/latency.
5. `improve/decision` → human approve/reject. Approval does NOT promote to
   production.

Bounds: max iterations defined, OpenAI budget defined before the run, stop on
plateau / convergence / budget / infra failure. Human decision before any
promotion.

## 6. Shadow mode (free on snapshots, no LLM in the harness)

`shadow.ts` runs agents against a frozen snapshot input with an injected run
function. Evidence level is `SNAPSHOT` — never `LIVE`. Use it to compare agents
on identical inputs and to replay a recorded run deterministically.

## 7. Export a candidate to TradeAgent (free build; human-only import)

`delivery.buildDeliveryPackage(...)` produces a versioned, checksummed package
in TradeAgent-intake shape with an honest `DeliveryStatus`. It **writes nothing
to TradeAgent and activates nothing**. To import:

1. Verify the checksum.
2. Push the `agents/<slug>/` files + `_registry.json` entry via the platform
   GitHub push (never a direct edit).
3. In TradeAgent `/admin/agents` → "Aigent intake" the agent shows as deployed
   → **[Activate]** (a back-office gesture; no trading/allocation/pricing).

## 8. Suspend / revoke a version

- Suspend: pause the copilot in Aigent (`status: paused`).
- Revoke a delivered version: in TradeAgent redeploy the previous version
  (rollback) or remove the `_registry.json` entry. No market state is affected.

## 9. Re-create everything from scratch

The socle is fully in-repo and deterministic. Re-running §2 reproduces the
entire non-LLM proof. §3–§5 (billed) re-materialize the agents from the same
roster config, so the factory is reproducible from source.
```
```
