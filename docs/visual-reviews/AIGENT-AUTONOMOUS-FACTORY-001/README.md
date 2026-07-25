# Visual review — AIGENT-AUTONOMOUS-FACTORY-001

UI surface: the **Qualification workflow** section added to the copilot Release
page (`/admin/agents/[id]` → Release tab), plus the honest creation `contract`
returned by the create API.

> Screenshots are **pending a live run**: rendering the Release page needs the dev
> server (port 3210) + a reachable gpu1 backend + a real candidate version. This
> document specifies exactly what renders in each state so a reviewer can verify it
> against a live capture; the states themselves are covered by the unit tests
> (`computeReadiness` + the timeline component consume the same data).

## Where it lives

- Component: `src/components/agent-ops/agent-detail/qualification-timeline.tsx`
- Mounted in: `src/app/admin/agents/[id]/release/page.tsx` — a new `Section`
  ("Qualification workflow") placed **after** In-production / Candidate and
  **before** the Release gate, so the operator reads the recommended next action
  first, then the underlying evidence.

## What it renders

A single **recommended next-action** line, the candidate version id, the ordered
5-step timeline, and a bounded, scrolling blockers list. It adds **no verdict of
its own** — it renders exactly what `computeReadiness(getLatestQualificationRun(...))`
produced (the same orchestrator the product API drives).

### Step rows (fixed order, always five)

```
Tests           Latest completed test run for this version.            ● Pass / Fail / Not configured
Benchmark       Latest completed benchmark for this version.           ● …
Shadow          Candidate vs production, via the real LangGraph path.  ○ Not available
Replay          Candidate replayed against the reference version.      ○ Not available
Promotion gate  The authoritative rollup the promote RPC re-reads.     ● Pass / Fail / Not measured
```

A step the workflow hasn't reached yet renders **Pending** — never a fabricated
status.

### States (meta chip + next-action wording)

| Run state | Chip | Next-action line |
| --- | --- | --- |
| not started | `Not started` | "Qualification not started — start it to evaluate this candidate version." |
| running | `In progress` | "Qualification in progress — next step: `<step>`." |
| promotable | `Promotion permitted` | "All gate checks pass — promotion is permitted. Run the promote action to ship this version." |
| blocked | `blocked` | "Qualification blocked — resolve the failing checks, then re-run qualification." + blockers |
| superseded | `superseded` | "Candidate changed during qualification — start a fresh run for the updated version." |
| aborted | `aborted` | "Qualification aborted — the candidate is no longer a draft/beta version…" |

**No "READY" pill anywhere.** The promotable state is phrased as an instruction
("promotion is permitted"), matching the codebase doctrine (lifecycle stages and
verdicts are muted text, never a status word). Enforced by test #13.

## Design-system compliance

- Status uses the same **dot + text** convention as `PromotionStatusText` /
  `CheckStatusText`: accent dot for `Pass`, `var(--state-danger-solid/text)` for
  `Fail`, a zinc ring for everything unmeasured/unavailable/pending — a fail is
  never painted like an unmeasured step.
- No native `<button>/<input>/<select>/<table>`; no raw hue class (only `accent` +
  `zinc` + the named `--state-danger-*` roles); no arbitrary spacing.
- Bounded height + internal scroll (`max-h-80 overflow-y-auto` on the step list,
  `max-h-40` on blockers) — the card never grows with the data. No sparklines.
- Gates: `npm run check:catalyst` ✓ and `npm run check:ds` ✓ (both green).

## Creation contract (API surface)

`POST /api/agent-ops/copilots` now returns `contract`:

```jsonc
{
  "ok": true, "copilotId": "copilot-…", "assistantId": "…",
  "contract": {
    "runtime": "langgraph", "runtimeExecutable": true, "stage": "draft",
    "assistantProvisioned": true,
    "tools": { "declared": 1, "resolved": 1, "certified": 1, "phantom": [], "uncertified": [] },
    "qualification": { "state": "not_started", "promotable": false, "nextAction": "…" }
  }
}
```

Every field is derived from live rows — nothing defaults to a passing value.

## To capture the screenshots (live)

1. `npm run dev` (port 3210) with gpu1 env + local LangGraph server up.
2. Create a candidate via `/admin/agents/new` (or the create API).
3. `POST /api/agent-ops/copilots/<id>/qualification {"versionId":"…","action":"sweep"}`.
4. Open `/admin/agents/<id>` → Release; screenshot the "Qualification workflow"
   section in the promotable and blocked states. Drop the PNGs beside this file.
