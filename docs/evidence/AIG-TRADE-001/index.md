# AIG-TRADE-001 — Visual QA evidence

Screenshots of the Trading Agent Factory surface (`/admin/trading-factory`),
captured by driving the real app via Playwright. No secret, token, or personal
data appears in any capture.

| File | Route | Viewport | State | Data source | Commit |
|---|---|---|---|---|---|
| `roster-desktop.png` | `/admin/trading-factory` | 1440×— (full page) | success / roster | ROSTER (static config) | see git log |
| `roster-mobile.png` | `/admin/trading-factory` | 375×— (full page) | success / mobile reflow, no horizontal scroll | ROSTER (static) | see git log |
| `agent-atlas.png` | `/admin/trading-factory` | 1440 | header + KPI band + Atlas row | ROSTER (static) | see git log |
| `agent-sentinel.png` | `/admin/trading-factory` | 1440 | **UNAVAILABLE** state — Sentinel/Pulse rows show unavailable tools (greyed, struck, with reason) | ROSTER (static) | see git log |

## Notes (honest)

- Every agent renders as **EXPERIMENTAL / "Non matérialisé"** — the six agents
  are defined but NOT yet materialized as OpenAI-backed copilots (that step is
  OpenAI-billed and awaits approval). The UI states this truthfully; it never
  shows a fake LIVE/DELIVERABLE badge.
- The UNAVAILABLE state is captured via `agent-sentinel.png`
  (`read_account_risk_snapshot` always unavailable; `read_liquidity_snapshot` /
  `read_funding_open_interest` unavailable — no order-book / perp source wired).
  An earlier `unavailable-state.png` was byte-identical to `agent-sentinel.png`
  and was removed as a duplicate rather than kept as padding.
- **Not captured**: the `EmptyState` (ROSTER empty) — the code path is wired,
  typed, and compiles, but ROSTER has 6 hardcoded agents and the source data
  was not mutated to force the empty case. Marked CODED, NOT VISUALLY VERIFIED.
- Console at capture: 0 errors, 0 warnings. Horizontal scroll: none at 375 or
  1440 (`scrollWidth <= innerWidth`).
