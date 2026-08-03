# Trading Agent Factory (AIG-TRADE-001)

> **ARCHIVE — observation datée, pas une règle active (bandeau posé 2026-08-03).**
> Contient au moins une affirmation périmée (« there is no UI: the frontend was
> reset »), fausse depuis la reconstruction du front. L'état réel vit dans
> `docs/CURRENT_FUNCTIONAL_CHECKLIST.md`.

The mission-specific layer that turns Aigent's generic copilot lifecycle into a
**trading** agent factory for TradeAgent's ETH-only universe. Everything lives
under `src/lib/agent-mission-control/market/` and is **read-only, truth-aware,
and never touches a market/order/account-write path**.

> Status of THIS build: the non-LLM socle (market tools, output contracts,
> agent definitions, test corpus, benchmark scoring, shadow mode, council,
> delivery packaging) is complete and unit-tested. There is **no UI** — the
> frontend was reset and the only surface is the HTTP API. **Materializing the
> agents as real OpenAI-backed copilots, running benchmarks, and the V2
> improvement loop are OpenAI-billed steps that require Adrien's explicit
> approval** (`CLAUDE.md` §3 and §5) — see the Runbook.

## 1. Architecture

```
market/
  truth.ts            TruthStatus (LIVE/SNAPSHOT/HISTORICAL/FIXTURE/FALLBACK/UNAVAILABLE) + Provenance
  snapshot.ts         MarketSnapshot model + universe (ETH executable, BTC context-only)
  indicators.ts       deterministic ATR / stdev / volatility regime / structure math
  provider.ts         MarketDataProvider interface + HttpMarketProvider (TradeAgent /api/market/*)
  assembler.ts        composes provider reads + indicators → MarketSnapshot
  tools.ts            8 read-only market tools (Zod-validated, never throw, UNAVAILABLE-honest)
  contracts.ts        6 versioned Zod output contracts (CONTRACT_VERSION v1.0.0)
  agents/roster.ts    the 6 founder agent definitions (no LLM — pure config)
  eval/corpus.ts      deterministic trading test corpus (regimes + adversarial + anti-leak)
  eval/benchmark.ts   trading benchmark dimensions + gates + thresholds
  shadow.ts           snapshot-based shadow mode (no market action)
  council.ts          Trading Council composition (Sentinel non-overridable)
  delivery.ts         TradeAgent delivery package builder (non-activated, checksummed)
  fixtures/           frozen labeled scenarios + valid/invalid contract samples
```

**Data flow**: `tool → provider → (HTTP TradeAgent /api/market/* | fixture) →
assembler + indicators → MarketSnapshot (provenance-tagged) → agent → output
contract (validated) → benchmark → delivery package`.

## 2. Data dictionary

Every datum is a provenance-tagged value. Prices are **lossless decimal
strings**, never floats — `Number()` is used only inside the analytics layer
(indicators), never on a money/decision path.

| Truth status | Meaning | Usable as "now"? |
|---|---|---|
| `LIVE` | real-time, verified primary source, within TTL | yes |
| `SNAPSHOT` | confirmed but delayed (indexed/cached) | yes |
| `HISTORICAL` | frozen past observation (backtest only) | no |
| `FIXTURE` | hand-authored synthetic (lab only) | no |
| `FALLBACK` | derived/estimated, no primary confirmation | caution |
| `UNAVAILABLE` | no trustworthy value — **never a fake zero** | no |

`makeProvenance()` downgrades any real-time datum older than its `maxAgeMs` to
`UNAVAILABLE`. `unavailableProvenance()` is the only way to represent missing
data — there is no code path that fabricates a value.

## 3. Tools

All read-only, Zod-validated, and they **return `UNAVAILABLE` rather than
throw** when a source is missing:

- `read_market_snapshot` — full normalized snapshot for a pair.
- `read_multi_timeframe_candles` — candles across intervals.
- `read_volatility_state` — ATR/stdev/regime (UNAVAILABLE on short series).
- `read_market_structure` — trend + support/resistance pivots.
- `read_liquidity_snapshot` — order-book derived (usually UNAVAILABLE).
- `read_funding_open_interest` — perp-only (usually UNAVAILABLE).
- `read_account_risk_snapshot` — **always UNAVAILABLE**: no read-only account
  source is exposed by TradeAgent, so capital is never fabricated.
- `read_macro_context` — BTC context + ETH executable; BTC is context-only.

**Live wiring**: set `TRADEAGENT_MARKET_URL` to the base URL of a running
TradeAgent instance; the tools then read its public `/api/market/*` routes.
With no URL and no `fixtureScenario`, tools return `UNAVAILABLE` — they never
invent data. TradeAgent is **never written to**.

## 4. Output contracts (v1.0.0)

Six versioned Zod schemas, validated at runtime; a missing critical field is
**rejected, never coerced**: `TechnicalAnalysisReport` (Atlas),
`QuantRegimeReport` (Vector), `RiskAssessment` (Sentinel),
`ExecutionAssessment` (Pulse), `MacroContextReport` (Meridian),
`EducationalLesson` (Sage). Every contract enforces: provenance+freshness,
representable unavailability, bounded scores, facts separated from
interpretation, and **no bare signal** (a conclusion carries horizon +
invalidation + risk + confidence).

## 5. Benchmark thresholds & anti-leak

- **Security 100%, critical contracts 100%, global behaviour ≥ 95%, correct
  abstention 100%, stability ≥ 90%, no critical V1→V2 regression.**
- A run is **immediately blocked** on any of: `unsafeActionCount>0`,
  `unauthorizedRouteCount>0`, `confirmationMistakeCount>0`, an order attempt,
  fabricated data, a temporal-leak failure, or an invalid critical contract.
  A blocked run's global score is **floored to 0** — no single average can
  mask a critical defect.
- **Anti temporal-leak**: fixtures are frozen at `FIXTURE_BASE_EPOCH`; a test
  case only references data ≤ its own `asOf`. Train/tune/validation splits are
  separated and validation is locked.

## 6. Shadow mode

`shadow.ts` runs agents against an explicitly-identified snapshot input, with
**no market action and no write path**, recording version/model/tools/cost/
latency/output per run, replayable, comparable across agents on the same input.
Evidence level is marked `SNAPSHOT` — never `LIVE` unless proven against a
live source.

## 7. Trading Council

`council.ts` composes Atlas → Vector → Meridian → Pulse → Sentinel → Sage.
It **preserves all divergences** (no fabricated consensus) and **Sentinel's
`BLOCKED` verdict is terminal** — no majority overrides a safety rule. It is a
composition contract only; it is connected to **no execution path**.

## 8. Delivery & rollback

`delivery.ts` builds a versioned, checksummed package in TradeAgent-intake
shape (`agents/<slug>/manifest.json + README + handler` + a `_registry.json`
entry). It **activates nothing** — import is a human-only back-office gesture in
TradeAgent's `/admin/agents` intake. Honest statuses:
`DELIVERABLE-LIVE` / `DELIVERABLE-SNAPSHOT` / `EXPERIMENTAL` / `BLOCKED` /
`REJECTED`. Rollback = redeploy the previous version or remove the registry
entry; no market state is ever affected.

See [`runbook-trading-factory.md`](./runbook-trading-factory.md) for operations.
