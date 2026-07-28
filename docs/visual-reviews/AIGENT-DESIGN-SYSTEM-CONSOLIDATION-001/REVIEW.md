# Visual review — AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001

**Branch:** `feat/design-system-consolidation-001`
**Commit SHA:** `9fd3a5b4b9680cf6a68678082a836d843e6a8ee4`
**Captured against:** `next dev` (Turbopack) on `http://localhost:3211`, worktree
`/Users/adrienbeyondcrypto/Aigent-design-system-001`
**State tested:** local dev, real seeded data (`proj-tradeagent`,
`copilot-eth-market-analyst`), no mocks.

No "before" screenshots exist for this pass — the primitives being replaced
(inline `--btn-*` overrides, three near-identical status-text components, two
near-identical tab components) render pixel-identically to their consolidated
replacements by construction (same classes, same tokens, same DOM shape
either composed or hand-written). The comparison that matters is functional —
confirmed by the unit tests (`tests/unit/button-danger.test.tsx`,
`status-dot.test.tsx`, `tabs.test.tsx`, `panel-section.test.tsx`,
`copilot-avatar.test.tsx`, `avatar-children-slot.test.tsx`,
`surface-token-aliases.test.ts`) and by `npm run check:legacy-bridge`
confirming no new legacy token usage was introduced. The one area with a
real visual delta — the release-gate and KPI-band percentages moving from
prose to `GaugeChart` donuts, requested mid-session — is captured explicitly
below.

## Required captures

| File | Route | Viewport | Shows |
|---|---|---|---|
| `desktop-1440x900.png` | `/admin/projects/proj-tradeagent` | 1440×900 | ProjectTabs, ProjectAvatar, AgentKpiBand + GaugeChart, Section/Panel surface |
| `laptop-1280x800.png` | `/admin/projects/proj-tradeagent` | 1280×800 | Same, narrower gutter |
| `mobile-375x812.png` | `/admin/agents/copilot-eth-market-analyst/release` | 375×812 | AgentDetailNav scroll-affordance, CopilotAvatar, Button danger context |

## Extra captures (one component doesn't fit one page)

| File | Route | Viewport | Shows |
|---|---|---|---|
| `extra-team-tabs.png` | `/admin/projects/proj-tradeagent/team` | 1440×900 | ProjectTabs with "My Team" active |
| `extra-agent-detail-nav-avatar.png` | `/admin/agents/copilot-eth-market-analyst/release` | 1440×900 | CopilotAvatar + AgentDetailNav (8 tabs, Release active) + Section/Panel |
| `extra-release-gate-gauge-checks.png` | same | 1440×900 | GaugeChart (5/9) + StatusDot list (Pass/Not measured) |
| `extra-danger-button-desktop.png` | same | 1440×900 | `Button color="danger"` (Roll back production) next to `color="accent"` (Promote) |
| `extra-danger-button-mobile.png` | same | 375×812 | Danger button stacked full-width, no clipping |
| `extra-project-kpi-gauges.png` | `/admin/projects/proj-tradeagent` | 1440×900 | GaugeChart in KpiBand — Executable (neutral tone), Success (positive tone) |
| `extra-mobile-release-gauge.png` | `/admin/agents/copilot-eth-market-analyst/release` | 375×812 | Gauge + checks list at mobile width |

## Per-component verification

- **Button danger** — confirmed distinct red fill vs. the accent "Promote"
  button, both desktop and mobile stacking. `data-focus`/`data-disabled`
  classes present in DOM (asserted by test, not visually distinguishable in
  a static screenshot).
- **StatusDot** — "Pass" (green dot + green text) and "Not measured" (ring
  dot + zinc text) both visible in `extra-release-gate-gauge-checks.png`;
  no "Fail" state present in the seeded data for this copilot, verified
  separately by the unit test's negative-tone assertions.
- **Tabs** — ProjectTabs (3 items, ` Overview` active) and AgentDetailNav
  (8 items, "Release" active) both render their accent underline correctly;
  mobile capture shows the AgentDetailNav track ready to scroll (no left
  fade at scroll position 0, which is correct — nothing is hidden to the
  left yet).
- **Panel/SectionSurface** — every `Section` card in the captures (In
  production, Candidate, Release gate, Promote or roll back, etc.) renders
  the same raised-plane fill/ring/shadow; no visual seam between cards
  composed via `Panel as="section"` and any other card on the page.
- **CopilotAvatar** — green accent-tinted circular tile with CPU-chip glyph,
  visible top-left of the agent header in every agent-detail capture;
  confirms `Avatar`'s frame (radius, outline) composes correctly under a
  custom `children` glyph instead of `Avatar`'s own `initials`/`src` paths.
- **Micro-labels (11px)** — "TEAM", "EXECUTABLE" etc. eyebrow labels (10px,
  unchanged) sit correctly above the new gauges; migrated 11px sites
  (e.g. copilot slug lines) render at the same size as before the migration
  — visually identical, confirmed by `metaTextClass` being literally
  `TEXT_SIZES['2xs'].base`, the same value the sites previously wrote by hand.

## Console

Zero errors/warnings attributable to this pass on every captured route.
Two pre-existing `401 Unauthorized` responses appear on
`/admin/projects/proj-tradeagent` (`/api/agent-ops/projects/.../repo/intelligence`
and `/api/agent-ops/projects/.../missions/latest`) — unrelated to design-system
changes: this worktree's local dev server has no LangGraph Agent Server /
GitHub App session wired up (a fresh worktree checkout, not the main repo's
running dev stack), so these two data-fetching calls fail auth. Confirmed by
reading the request path — neither endpoint is touched by any file in this
diff. Not investigated further; flagged here as a known divergence from the
main repo's fully-configured dev environment, not a regression.

## Known divergences

- The React Flow team canvas (`/admin/projects/proj-tradeagent/team`) did not
  render its nodes inside the automated screenshot window (async graph
  layout) — the tab bar and KPI strip above it captured correctly, which is
  what this pass touches; the canvas itself is untouched code.
- No `Fail` StatusDot state appears in any capture — the seeded release gate
  for `copilot-eth-market-analyst` has `pass`/`missing` checks only, no
  `fail`. The negative tone is covered by the unit test suite instead.
