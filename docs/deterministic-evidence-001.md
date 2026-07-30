ARCHIVED — historical state, not current doctrine

# AIGENT-DETERMINISTIC-EVIDENCE-001 — deterministic evidence for tests & benchmarks

Branch: `feat/deterministic-evidence-001` · base SHA `0b91ce6` (contains PR #19 /
promotion-evidence migrations 0029–0033). **Not merged, not deployed.**

## Why this exists

`scripts/prove-factory-e2e.ts` proved the factory chain end-to-end, but steps 3
(tests) and 4 (benchmark) wrote `test_runs` / `test_results` / `benchmark_runs` /
`benchmark_results` **directly** via `pgrest('POST', …)`, each flagged
`real: 'direct-write'` with a `defect:` string:

> "no deterministic test/benchmark adapter — runTestSuite/runBenchmarkSuite
> requires a billed LLM run per case, so a $0 offline proof must write test
> evidence directly."

That is the hole this chantier closes: the test and benchmark runners now accept
an **injected deterministic executor** that produces reproducible evidence with
**no billed LLM call**, while the evidence still flows through the **same official
persistence path and gate** as a real run. No result row is written directly.

## The abstraction — one seam, two legs

A test/benchmark run makes exactly two calls that reach a billed LLM: the **agent
leg** (run the case on the copilot's runtime) and the **judge leg** (a strict-JSON
grader). Everything else — loading the suite, the ground-truth tool-call gate, the
deterministic safety assertions, aggregation, persistence, and the release gate —
is pure of the model.

`evidence/execution-adapter.ts` defines `EvidenceExecutionAdapter` — that seam, and
nothing else. It generalises the injected-runner pattern the shadow/replay engines
already use (`ShadowRunAgent`, `ReplayRunner`) to the two runners that lacked it.

- `evidence/live-adapter.ts` — the **default**. A faithful, behaviour-preserving
  extraction of the agent + judge legs that previously lived inline in the runners
  (`executeCaseOnRuntime`, `runTaskOnGraph`/`runTaskOnDirectEngine`). An ordinary
  user run is byte-for-byte unchanged — proven by the 50 pre-existing runner tests
  (`test-runner-runtime-routing`, `benchmark-runner-runtime-routing`,
  `benchmark-safety-assertions`, `benchmark-score`) still passing.
- `evidence/deterministic-adapter.ts` — a **test-only** fixture. It runs the REAL
  certified `count_words` tool (measured, not asserted), can script success / wrong
  answer / tool error / timeout / uncertified-tool refusal, and renders a scripted
  judge verdict in the exact strict-JSON shape each runner parses. Cost is an
  honest `0`.

`runTestSuite` / `runBenchmarkSuite` gained one optional `adapter?` arg, defaulting
to the live adapter. The runners **never read request data** to choose an adapter.

## Three execution paths, named honestly

| Path | What it is | Where it may run | Evidence label |
|---|---|---|---|
| **Real LangGraph** (canonical target) | A candidate version executed through the real Agent Server. See "Canonical LangGraph" below. | production + non-prod | `execution_mode='live'` |
| **Direct / model-router** (`executeCopilotRun`) | The `openai-assistants` runtime path. A real, billed engine, but a **parallel** product runtime to LangGraph. | production + non-prod | `execution_mode='live'` |
| **Deterministic fixture** | The `$0` offline executor in this chantier. | **tests / CI / proof scripts / explicit-local ONLY** — never production. | `execution_mode='deterministic-fixture'` |

### Divergences between the paths

- **Real LangGraph vs direct/model-router**: the direct path always loads the
  *candidate version's own* manifest (`loadManifestRunConfig(versionId)`), so it is
  candidate-faithful. The LangGraph path historically ran against the copilot's
  *already-provisioned* assistant, which may be stale for a candidate — the
  KNOWN LIMITATION documented in `shadow-replay-routes-shared.ts`. See below.
- **Fixture vs either real path**: the fixture makes **no billed call** and its
  outputs are scripted (deterministic). It executes only the `count_words`
  certified tool for real; it never drives a model. It is labelled
  `deterministic-fixture` and is **fail-closed out of production** (below).

## Provenance & enforcement

Migration `0037_evidence_execution_mode.sql` adds a NOT-NULL `execution_mode` column
(default `'live'`, CHECK in `('live','deterministic-fixture')`) to `test_runs` and
`benchmark_runs`. The runners stamp it from `adapter.label`. Existing rows backfill
to `'live'` — which is what they were.

**No fixture-backed proof can satisfy a production promotion.** Two independent
guards:

1. **The adapter can't be built in production.** `evidence/guard.ts` is fail-closed:
   `isProductionRuntime` treats production AND any unknown/unset `NODE_ENV` as
   production; a deterministic adapter is constructible only in a recognised
   non-prod context (VITEST / `NODE_ENV=test` / CI / explicit
   `AIGENT_DETERMINISTIC_EVIDENCE=allow`). The decision keys **only** off server
   env, never off request data — so activation via an env var, an API param, a
   manifest field, a user payload, or persisted config is all refused in
   production identically (tested, all five vectors).
2. **The gate ignores fixture rows.** `release-gate.ts` reads
   `test_runs` / `benchmark_runs` with `execution_mode=eq.live`. A fixture row is
   invisible to a production promotion — even if one existed in the shared DB, it
   could never make a candidate promotable.

## Canonical LangGraph — the un-blocker, and what is BLOCKED

The directive for this session: **LangGraph is the canonical runtime; do not
institutionalise a fixture-backed evidence path or the direct/model-router as a
parallel product runtime; real Shadow/Replay must execute a candidate through real
LangGraph; fixtures live only in tests.**

Applied here:

- **Fixtures are test-only** (guarded, above) and the fixture is **not** used to
  satisfy any production gate.
- **The un-blocker is delivered**: `langgraph-assistants.ts` gains
  `loadCandidateBehaviorConfig(versionId)`, `assistantIdForCandidate(versionId)`,
  `ensureCandidateAssistant(versionId)`, `deleteCandidateAssistant(versionId)`.
  This provisions an **ephemeral assistant built from the candidate version's own
  manifest**, keyed by a **version-scoped id in a distinct namespace** from the
  copilot's production assistant — so a candidate can be executed in real LangGraph
  **without modifying the production assistant**. `loadCandidateBehaviorConfig` (the
  faithfulness core) is unit-tested offline (`candidate-assistant-config.test.ts`).

### BLOCKED: the real billed LangGraph proof

A real candidate run through LangGraph **cannot be executed or verified in this
session**, for two concrete reasons:

1. **The Agent Server is unreachable from this host.** `127.0.0.1:2024` does not
   accept connections, and `.env.local`'s `LANGGRAPH_API_URL` points at the remote
   (`agent.hearst.app`), which `agent-server-endpoint.mjs` refuses outside
   production.
2. **A real candidate run is a billed step.** Per `CLAUDE.md` §3 (ask before a
   significant external cost), a billed
   materialisation/run is executed only with Adrien's explicit agreement.

So `ensureCandidateAssistant`'s provisioning + a real thread run are **coded, not
verified** — the config derivation and id-scoping are proven offline; the
server-reaching calls are not exercised.

### Direct / model-router path — limitation & deprecation plan (point 7)

The direct path (`executeCopilotRun` on `openai-assistants`) remains functional and
is **not** removed — the runners, shadow/replay callbacks, and existing consumers
still depend on it. It is documented here as an **internal engine, not a competing
product runtime**. The intended trajectory:

1. Wire real Shadow/Replay (and, where useful, test/benchmark) onto
   `ensureCandidateAssistant` so the canonical evidence path is real LangGraph.
2. Once every consumer runs on LangGraph candidate execution, narrow the direct
   path to an internal fallback and mark it deprecated — **without breaking
   consumers before integration**.

This step is left to the integrator because it spans the shadow/replay routes
(owned by the concurrent `feat/factory-shadow-replay-001` chantier) and must not be
done blind against an unreachable Agent Server.

## Tests (all offline, `$0`)

- `deterministic-evidence-guard.test.ts` — the fail-closed guard: production refuses
  all five activation vectors; recognised non-prod contexts allowed; adapter
  un-constructable in prod.
- `deterministic-evidence-adapter.test.ts` — the fixture's agent + judge legs: real
  `count_words`, wrong answer, tool error, timeout, uncertified-tool refusal,
  runner-correct judge JSON, fail-closed on an unscripted input.
- `deterministic-evidence-runners.test.ts` — scenarios 1–9, 13, 14 driven through
  the **real** `runTestSuite`/`runBenchmarkSuite` (green suite, red, tool error,
  ghost tool, uncertified tool, timeout, benchmark higher/lower/absent, no secret in
  any persisted row, versioned re-run) — **no direct SQL into result tables**.
- `deterministic-evidence-gate.test.ts` — scenario 10 (non-deterministic labelled →
  INCONCLUSIVE via the replay engine), 11 (wrong-version evidence refused), 14b
  (latest run wins), and point 6 (fixture rows never satisfy the gate).
- `candidate-assistant-config.test.ts` — the candidate-faithful config + the
  version-scoped assistant id.

## Verdict

**`DETERMINISTIC_EVIDENCE_PARTIAL`.**

- **Delivered & verified offline**: the injectable adapter seam (live default +
  deterministic fixture), the fail-closed guard, the `execution_mode` provenance
  column, the gate-level rejection of fixture evidence, the candidate-faithful
  ephemeral-assistant mechanism (config core), and the 14 required scenarios. The
  live path is unchanged (50 pre-existing runner tests green).
- **Not done, by direction**: the E2E factory proof is **not** rewired to promote a
  real agent on fixture-backed evidence — that would let a fixture satisfy a
  production gate, which the directive forbids. The mission's original READY
  criterion ("run the E2E via the deterministic adapter through to promotion") is
  therefore deliberately not met.
- **BLOCKED**: the real LangGraph candidate-execution proof (`SHADOW_REPLAY`-grade
  evidence) — the mechanism is coded but the billed run is blocked on Agent Server
  reachability and §8 agreement (above). No two competing runtimes were
  institutionalised; the direct/model-router path is documented for limitation.
