ARCHIVED — historical state, not current doctrine

# AIGENT-AUTONOMOUS-FACTORY-001 — Autonomous Factory

> Branch: `feat/autonomous-factory-001` · Base: `0b91ce6` (head of PR #19) · Migrations: `0040`
> Verdict: **AUTONOMOUS_FACTORY_PARTIAL** (see [§9](#9-verdict)).

## 1. Objective

Build the main product journey:

> *I describe an agent → Aigent creates a coherent candidate → the qualification is
> orchestrated → the version becomes promotable.*

This chantier owns the **creation** and the **orchestration workflow**, **not** the
internal proof engines (tests, benchmark, shadow, replay). Those are consumed
through their existing interfaces or left as isolated integration points.

## 2. What was built

| Area | Deliverable | File |
| --- | --- | --- |
| Creation (compensable) | `createCopilotFromManifest` now all-or-nothing + `PartialCreationError` | `src/lib/agent-mission-control/authoring-writes.ts` |
| Creation contract | `describeCandidate` → runtime, resolved+certified tools, assistant, readiness | `src/lib/agent-mission-control/qualification-orchestrator.ts` |
| Orchestration service | tests → benchmark → shadow → replay → gate, version-scoped/idempotent/resumable | `src/lib/agent-mission-control/qualification-orchestrator.ts` |
| Workflow state | `qualification_runs` table (ledger only) | `supabase/migrations/0040_qualification_runs.sql` |
| API | `GET/POST /api/agent-ops/copilots/:id/qualification` + create contract in the create response | `src/app/api/agent-ops/copilots/[copilotId]/qualification/route.ts`, `.../copilots/route.ts` |
| UI (removed since, P007) | Qualification timeline + recommended next action on the Release page | was `src/components/agent-ops/agent-detail/qualification-timeline.tsx`, `src/app/admin/agents/[id]/release/page.tsx` — deleted with the legacy dashboard front |
| Tests | 14 mandatory scenarios | `tests/unit/qualification-orchestrator.test.ts`, `tests/unit/autonomous-factory-creation.test.ts`, `tests/unit/autonomous-factory-route.test.ts` |
| E2E | Product-path proof (route handlers only) | `scripts/prove-autonomous-factory-e2e.ts` |

## 3. Creation — transactional / compensable

`POST /api/agent-ops/copilots → createCopilotFromManifest` writes four rows
(`copilots → manifests → tools → copilot_versions`). PostgREST has no cross-table
transaction, so instead of leaving orphan rows on a mid-sequence failure (the
prior behaviour), the function now **compensates**: once the parent `copilots`
row exists, any later failure triggers a single `DELETE copilots?id=eq.<id>` and
the DB cascades every child away. Exhaustive outcomes:

- success → all rows present, id returned;
- failure before the parent row → nothing written, cause rethrown;
- failure after, compensation succeeds → nothing persisted, cause rethrown;
- failure after, compensation **also** fails → `PartialCreationError` naming the
  orphan (the only non-silent partial — raised loudly for operator cleanup).

The route keeps its own compensation for the one side effect outside this DB set:
the LangGraph assistant (provisioned after the rows), rolled back with
`deleteCopilotCascade` on failure → 502. **No silent partial creation.**

### Creation contract

The create response now carries the honest `contract`: the draft version + manifest
ids, `runtime` + `runtimeExecutable`, a tool `{declared, resolved, certified,
phantom[], uncertified[]}` report resolved against the canonical registry, whether
the assistant was provisioned, and the (not-yet-started) qualification readiness.
Nothing is defaulted to a passing value.

## 4. Qualification orchestration service

A single service walks **one candidate version** through:

```
tests → benchmark → shadow → replay → gate
```

It is a **workflow layer, not a proof engine**. Each step consumes an existing
engine and records its honest verdict:

| Step | Consumes | Absent evidence → |
| --- | --- | --- |
| tests | latest completed `test_runs` / `test_results` | `NOT_CONFIGURED` |
| benchmark | latest completed `benchmark_runs` / `benchmark_results` | `NOT_CONFIGURED` |
| shadow | `shadow_experiments` (real LangGraph driver, isolated seam) | `NOT_AVAILABLE` |
| replay | `replay_comparisons` (real LangGraph driver, isolated seam) | `NOT_AVAILABLE` |
| gate | `evaluateAndPersistPromotionGate` — **the authority** | persists a fresh `promotion_gates` row |

Statuses reuse the promotion-gate vocabulary (`PASS/FAIL/NOT_CONFIGURED/
INSUFFICIENT_EVIDENCE`) plus the mission-sanctioned `NOT_AVAILABLE` / `PENDING`.
No parallel status vocabulary was invented.

### Guarantees (enforced, tested)

- **Idempotent** — `client_run_id` unique per copilot (mirrors `agent_runs`,
  migration 0027) + one-active-run-per-version partial-unique index; a double
  submit collapses onto the existing run.
- **Resumable** — a step that throws (infra) leaves the cursor untouched; the next
  advance re-runs exactly that step. Step transitions are a compare-and-set PATCH
  (`step_cursor` + `status='running'`), so a concurrent double-advance is a no-op
  for the loser.
- **Version-scoped** — every read/write is bound to `(copilotId, versionId)`; a
  version that belongs to a different copilot is refused (IDOR).
- **Candidate-mutation resistant** — a `candidate_fingerprint` (sha256 over model,
  provider, and the manifest's behavioural fields + sorted `tool_ids`) is pinned at
  start and re-checked before each step; drift → the run is `superseded`.
- **Archival/deletion aware** — a candidate archived/promoted/deleted mid-workflow
  aborts the run.
- **No auto-promotion** — the sweep stops at the gate. Promotion stays the explicit,
  privilege-separated `.../promotion` route action. `promotable` is a *state*, never
  an act.

## 5. Anti-bypass invariants preserved

- The orchestrator **never** writes `copilots.status`, `production_version_id`, or
  `copilot_versions.stage`, and never calls the promote RPC. The privilege
  separation of migration 0033 (only `aigent_promotion_executor` via the SECURITY
  DEFINER RPC) is untouched. (Proven: test #14 asserts zero such writes/calls.)
- The gate step re-persists a fresh `promotion_gates` row each run, preserving the
  latest-row / TTL freshness semantics the RPC relies on.
- shadow/replay reads are filtered on `candidate_version_id`, so a different
  version's evidence can never satisfy this candidate's step (test #10).

## 6. LangGraph directive compliance

Per the standing decision *"LangGraph is the canonical runtime; no fixture-backed
proof may satisfy a production gate"*:

- The orchestrator's shadow/replay steps target the **real LangGraph
  candidate-execution path** through an injected `ShadowReplayDriver` seam. That
  driver is owned by the shadow/replay engine perimeter (`feat/factory-shadow-replay-001`)
  and is **absent** here → the step is `NOT_AVAILABLE`.
- A fixture driver may be injected **only in tests**. In a production request no
  driver is wired, so no fixture-backed shadow/replay evidence is ever produced,
  and the gate re-reads the real evidence tables independently.
- The **direct / model-router path** (`src/lib/agent-mission-control/runner.ts` +
  `model-router`) remains as an internal execution component invoked *by* LangGraph
  and by the test/benchmark runners; it is **not** exercised as a parallel product
  execution path by this workflow. Limiting or deprecating it for consumers is an
  integration-phase task (Agent 4) and is out of this branch's scope — flagged, not
  changed, to avoid breaking consumers before integration.

Because the real LangGraph shadow/replay execution is out of this perimeter, the
shadow/replay **capability is honestly `NOT_AVAILABLE` / PARTIAL** here rather than
institutionalizing a second runtime.

## 7. Migrations

`0040_qualification_runs.sql` — the version-scoped workflow ledger. Additive,
idempotent, RLS-enabled (service_role via BYPASSRLS), explicit grants (new tables
are not covered by 0001's blanket grant). It is a **ledger only**: it never
duplicates proof and cannot make a version promotable on its own.

Migration numbers `0034–0039` are reserved for the sibling engine branches
(shadow/replay `0034–0036`, deterministic evidence `0037–0039`); this branch stays
strictly within its `0040–0042` allocation and touches no already-applied
migration. Application against gpu1 is an out-of-band step (there is no in-repo
migration runner).

## 8. Test coverage — the 14 mandatory scenarios

| # | Scenario | Where |
| --- | --- | --- |
| 1 | full creation | `autonomous-factory-creation` (insert order), `autonomous-factory-route` (201 + contract), `qualification-orchestrator` (contract) |
| 2 | invalid runtime | `qualification-orchestrator` (runtimeExecutable=false) + route Zod `z.literal('langgraph')` |
| 3 | phantom tool | `qualification-orchestrator` (resolveCandidateTools.phantom) |
| 4 | uncertified tool | `qualification-orchestrator` (resolveCandidateTools.uncertified) |
| 5 | error after copilot before manifest | `autonomous-factory-creation` (compensation + PartialCreationError) |
| 6 | assistant creation error | `autonomous-factory-route` (rollback → 502) |
| 7 | double submission | `qualification-orchestrator` (idempotent client_run_id + in-flight) |
| 8 | resume after failure | `qualification-orchestrator` (thrown step, cursor unchanged, resumes) |
| 9 | candidate change | `qualification-orchestrator` (superseded on fingerprint drift) |
| 10 | evidence from another version | `qualification-orchestrator` (cross-version shadow scoped out) |
| 11 | deletion/archival during workflow | `qualification-orchestrator` (aborted) |
| 12 | ownership / IDOR | `qualification-orchestrator` (idor + not_found) |
| 13 | no lying READY | `qualification-orchestrator` (state phrasing, promotable flags) |
| 14 | no automatic promotion | `qualification-orchestrator` (zero status/stage writes, no RPC) |

25 new tests, all green. Full suite: **1374 passed**. `npm run check`: **exit 0**
(typecheck, lint, ds, catalyst, agent-truth, danger, render-truth, status-truth,
registry-parity, registry-integrity, dead-code).

### E2E product proof

`scripts/prove-autonomous-factory-e2e.ts` drives the journey through the **product
route handlers only** (create → read-back → qualify sweep → resume → DELETE
cleanup); it performs **no direct SQL insert** of a copilot/version/manifest after
the initial product call. It was **not executed live in this session**: step 1
provisions a real LangGraph assistant and schedules billed auto-eval, and neither
the live gpu1 backend nor the local Agent Server was confirmed reachable here.
Running it is the live proof; the executed proof in this session is the unit suite
above.

## 9. Verdict

**AUTONOMOUS_FACTORY_PARTIAL.**

READY requires *"an agent created without manual repair after the initial product
call"* proven end-to-end. The creation path, the compensable transaction, the
orchestration service, the API, the UI, and all 14 scenarios are delivered and
green offline. It is **PARTIAL**, not READY, for two honest reasons:

1. **shadow/replay real execution is out of perimeter** — by design and per the
   LangGraph directive, this branch consumes the engine interface and reports
   `NOT_AVAILABLE` rather than shipping (or faking) the driver. That capability is
   owned by `feat/factory-shadow-replay-001` and lands at integration.
2. **The live E2E was not executed** — it needs a reachable gpu1 backend + local
   LangGraph Agent Server and triggers a billed auto-eval, neither confirmed nor
   approved in this session.

Neither gap is a defect in the delivered workflow; both are scope/environment
boundaries stated plainly so integration (Agent 4) can close them.
