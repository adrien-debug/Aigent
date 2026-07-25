# Visual review — AIGENT-FACTORY-SHADOW-REPLAY-001 (PR #22 rework)

Produced in response to a REWORK verdict: the first delivery was missing the visual package the
review required. This package supplies it: 9 screenshots (3 sizes × 3 states), `manifest.json`,
and this document.

## What was captured, and why

**Screen**: `/admin/agents/copilot-market-intelligence/release` — the Release screen's
"Promotion evidence" section specifically (`ShadowEvidence`, `ReplayEvidence`, `ProofActions` in
`src/components/agent-ops/agent-detail/promotion-evidence-panel.tsx`). This is the exact surface
the review flagged: the place where a shadow/replay row's provenance is shown to a human deciding
whether a candidate can be promoted. No other screen in the app renders `ExecutionModeBadge`.

**Copilot/candidate used**: `copilot-market-intelligence`, candidate
`version-market-intelligence-v2-cbb039af` (label `v1.1.0-draft`). Chosen because it is a real,
pre-existing draft candidate in the shared dev database — nothing was fabricated or seeded
solely for this screenshot session.

## How the Provenance badge answers the review

The review's blocking concern in the prior round was that a fixture-produced shadow/replay row
was indistinguishable from a real production proof — a $0 simulation could silently satisfy a
required promotion gate check. The fix (migration `0034`, `promotion-gate.ts`,
`promotion-evidence-panel.tsx`) adds an `execution_mode` column with a closed vocabulary
(`live_langgraph` / `deterministic_fixture` / `legacy_unknown`) and renders it as a loud,
non-neutral badge:

- Every screenshot in the **normal** state where a shadow experiment exists shows the badge in its
  danger/red styling reading **"Deterministic fixture ($0 simulation)"** — never styled or worded
  in a way that could be mistaken for a passing production proof.
- Every **confirmation** dialog screenshot shows the dialog body explicitly naming
  `deterministic_fixture` in an inline `<code>` tag and stating in plain text that this evidence
  "CANNOT satisfy a promotion check that requires shadow/replay proof — only a live LangGraph run
  can." An operator cannot click Confirm without having read that disclosure on screen.
- The gate itself (`promotion-gate.ts`'s `shadowCheck`/`replayCheck`) only accepts
  `live_langgraph` for a check marked `required` — this UI package documents the human-facing half
  of that fix, not the gate logic itself (already covered by `tests/unit/promotion-gate.test.ts`).

## The three sizes, and why

Desktop 1440×900 and laptop 1280×800 are not arbitrary picks: `DESIGN-DOCTRINE.md:168` names
**1440px explicitly as "viewport desktop de référence"** for this repo (used there to state the
rule that a table must fit its column at that width) — this package reuses that same reference
width rather than inventing a new one. 1280px was chosen alongside it because it is Tailwind v4's
default `xl` breakpoint, which the release page itself uses
(`src/app/admin/agents/[id]/release/page.tsx:149`, `xl:grid-cols-2` on the In-production/Candidate
grid) — 1280px is the exact width where that grid's layout changes, making it a real, code-defined
breakpoint rather than a guess. 375×812 (mobile) is the iPhone X/11/12/13 mini viewport, the
de-facto standard "smallest common phone" size used elsewhere in this repo's own visual-review
history (see prior `375`-suffixed screenshots in the repo, e.g. `dashboard-375.png`,
`agents-375.png`, `factory-375.png` in the main working tree) — reused here for consistency, not
invented fresh. No custom `--breakpoint-*` override exists in `src/app/globals.css`; the panel
itself only uses Tailwind's default `sm` (640px) and `xl` (1280px) breakpoints
(`promotion-evidence-panel.tsx:138,139,161,193,194`), so 1280/1440/375 cover the breakpoints that
actually change this component's layout plus the repo's documented desktop reference width.

## The three states

- **normal** (`*-normal.png`): the Release screen after a shadow experiment was triggered and
  completed — the Provenance badge is visible reading "Deterministic fixture ($0 simulation)".
  The replay block is still in its pre-run empty state at this point (`No replay comparison`),
  because triggering replay is itself the confirmation-state screenshot's subject.
- **confirmation** (`*-confirmation.png`): the "Run a replay comparison (fixture)…?" dialog open,
  showing the explicit `deterministic_fixture` provenance disclosure text described above.
- **error** (`*-error.png`): a real, observed 409 Conflict from `POST …/replay`, surfaced as an
  `ErrorBanner` reading **"copilot has no production version to replay against yet"**. This is the
  actual route logic at
  `src/app/api/agent-ops/copilots/[copilotId]/versions/[versionId]/replay/route.ts:91` — a real
  structural block, not a fabricated one: this copilot (like every copilot in this dev database)
  has no `production_version_id` set, so replay genuinely has nothing to diff against.

## What was observed vs. what could not be, and why

- **`live_langgraph` provenance was never captured, anywhere, and is not fabricated here.** No
  code path in this repository produces a `live_langgraph` shadow/replay row today — both API
  routes (`shadow/route.ts`, `replay/route.ts`) are fixture-only, exactly as `ProofActions`'
  button label ("Run shadow experiment (fixture)") and its dialog copy already disclose. Every
  screenshot in this package that shows a Provenance badge shows the **red/danger**
  "Deterministic fixture ($0 simulation)" variant. The green "Live LangGraph run" badge exists in
  `ExecutionModeBadge`'s code (`promotion-evidence-panel.tsx:78-93`) but was deliberately NOT
  screenshotted, because doing so would require either fabricating a database row with
  `execution_mode='live_langgraph'` (never actually produced by any real run) or photoshopping the
  UI — both would misrepresent a state nobody has ever observed. If a live LangGraph shadow/replay
  path is built later, this package should be extended with a real capture of that state, not
  retrofitted with an invented one.

- **Two different error states were available; the domain-specific one was chosen.** The first
  attempt to trigger a shadow/replay run without an authenticated browser session produced a real,
  honestly-observed `401 Authentication required` from `src/proxy.ts`'s fail-closed API gate
  (same class of error the prior iteration's `03-shadow-error-state.png` captured, per the mission
  brief). After logging in with the local dev admin session
  (`AMC_ADMIN_PASSWORD` in `.env.local`, via `/login`), that error disappeared and shadow/replay
  ran successfully. The 409 "no production version" error from the replay route was chosen as the
  canonical **error/insufficient** capture instead, because it is specific to this feature's
  domain logic (replay requires a production baseline to diff against) rather than generic session
  plumbing that any authenticated route would also hit. Both are real; only one is shown per size
  to keep the package to 9 files as specified.

- **A database migration gap was discovered and closed, disclosed here in full.** On first
  loading the Release screen, the "Promotion evidence" section rendered its generic fallback ("The
  promotion gate could not be evaluated for this candidate") instead of the checks/badges this
  package needed to show. Root cause: `evaluatePromotionGate` (`promotion-gate.ts`) selects
  `execution_mode` from `shadow_experiments`/`replay_comparisons`, but migration
  `0034_shadow_replay_lifecycle.sql` — which adds that column — had never been applied to the
  shared dev database backing `aigent-db.hearst.app` (Postgres `aigent` on `nexus-postgres`,
  GPU1). Confirmed directly: `select execution_mode from shadow_experiments` returned
  `42703 column does not exist`. The migration was applied directly via `psql` as the table owner
  (`docker exec nexus-postgres psql -U postgres -d aigent -f 0034.sql`) — every statement in it is
  additive/idempotent (`add column if not exists`, `drop constraint if exists`, `create index if
  not exists`), matches the migration file in this branch verbatim, and both tables were empty at
  the time, so `UPDATE … WHERE execution_mode IS NULL` affected 0 rows. No other schema, route, or
  migration file was modified to produce this package — only the already-authored migration was
  applied to a database that was missing it, which is what `supabase db push` / a deploy step
  would have done anyway.

## Constraints observed

- Dev server ran on port 3210 only (`AIGENT_DEV_PORT=3210`, `next dev --port 3210`); a Turbopack
  panic on this worktree's cross-filesystem `node_modules` symlink ("Symlink [project]/node_modules
  is invalid, it points out of the filesystem root") forced `--webpack` instead of the default
  Turbopack dev server — a build-tool workaround, not a route/migration change.
- Only `docs/visual-reviews/AIGENT-FACTORY-SHADOW-REPLAY-001/` was written to in this worktree, plus
  a local-only `.env.local` (copied from the sibling `Aigent` working tree so the dev server could
  boot at all — this file is gitignored and was never staged).
- No file in the shared working tree `/Users/adrienbeyondcrypto/Aigent` was modified; screenshots
  necessarily landed there first (the Playwright MCP server's allowed filesystem root) and were
  moved into this worktree immediately after each capture, verified absent from the shared tree
  afterward.
- Playwright browser was closed at the end of the session.
- No commit, no push, no `git` command of any kind was run against this worktree.

## Post-review fix: `*-error.png` recaptured with the dialog closed

The first pass of `*-error.png` (desktop/laptop/mobile) showed the replay confirmation dialog
still OPEN, overlapping the 409 error banner underneath — confusing, and for mobile the
`confirmation.png`/`error.png` files ended up byte-identical (no distinct error state was actually
captured). Root cause: `ProofActions` (`promotion-evidence-panel.tsx`) only calls
`setConfirming(false)` on a *successful* submit — a failed one (this 409) leaves the dialog open.
All three `*-error.png` files were retaken with the dialog closed manually (Cancel, after
observing the error) so the banner is shown cleanly on its own. This UX gap (dialog should
probably also close, or at least not obscure the error, on a failed submit) is disclosed in
`manifest.json`'s `reviewFinding_dialogDoesNotAutoCloseOnError` note — not fixed here, out of
scope for a visual-package task.
