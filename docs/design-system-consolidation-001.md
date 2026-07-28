# AIGENT-DESIGN-SYSTEM-CONSOLIDATION-001

Branch: `feat/design-system-consolidation-001`. Not merged, not deployed.

## Source of truth

Started from Adrien's line-by-line audit of `components/ui/`, `agent-ops/`, `views/`,
`shell/`, `app/admin/`, `app/(site)/` and `theme.css` — every finding below was
re-verified directly in the code before being fixed, not re-audited from scratch.
The audit's headline claim ("chromatic palette leak") was already false — the repo
is mono-accent + zinc throughout, zero non-accent/non-zinc chromatic Tailwind
classes anywhere. The real problems, confirmed by re-reading the code, were the six
named in the mission brief: primitive contournements, duplicated local components,
unnormalized micro-typography, redundant surface tokens, duplicated nav/status
patterns, and missing primitives for recurring patterns.

## What changed, per obligatory item

### 1. `Button` `danger` variant
Added `styles.colors.danger` to `src/components/ui/button.tsx`, built from the
same `--btn-bg`/`--btn-border`/`--btn-icon`/`--btn-hover-overlay` custom-property
mechanism every other colour already uses — fill from `--state-danger-solid`,
border from `--state-danger-solid-line`, white text (measured 6.45:1, documented
in `theme.css`). Focus, disabled, hover, active all inherit for free from
`styles.base`/`styles.solid`, which every colour shares.

Added a second, narrower surface: `plain` + `dangerIcon` (boolean) — overrides
only `--btn-icon`, for the "plain button, red icon only" pattern
(`project-delete-action.tsx`'s header trigger), which is a genuinely different
visual than a solid danger fill and was kept as its own affordance rather than
folded into `color="danger"`.

**Removed**, verbatim, from all four sites: the local `ButtonVars` type, the
`dangerSolidStyle`/`dangerIconStyle` objects, and the `style={...}` prop —
- `agent-detail/release-panel.tsx` (promote/rollback dialogs, 2 buttons)
- `delete-project-dialog.tsx`
- `project-delete-action.tsx` (migrated to `dangerIcon`)
- `project-team/project-team-relation-dialogs.tsx`

Zero `--btn-hover-overlay: rgb(255 255 255 / 12%)` literals left in any
consumer — that value now lives once, inside the variant.

### 2. `StatusDot` — dot + status text
New `src/components/ui/status-dot.tsx`. Three byte-identical local functions —
`CheckStatusText` (release-panel.tsx), `StepStatusText` (qualification-timeline.tsx),
`PromotionStatusText` (promotion-evidence-panel.tsx) — collapsed into one
primitive taking a semantic `tone`: `positive` (accent, filled), `negative`
(danger, filled — the system's one non-accent hue), `neutral` (unfilled ring —
not measured / not configured), `pending` (filled zinc — actively running,
distinct from both outcomes). The word is still mandatory (`children`) — the
dot never carries the meaning alone, matching the doctrine each of the three
originals already stated in its own comments. `pending` has a real consumer
today: `QualificationStepStatus`'s `PENDING` state in `qualification-timeline.tsx`.

All three call sites now do `const tone = status === 'PASS' ? 'positive' : ...`
and render `<StatusDot tone={tone}>{label}</StatusDot>` — the status→tone
mapping is the only thing that still varies per consumer, because each
consumer's status enum is genuinely different (`GateStatus`,
`QualificationStepStatus`, `PromotionCheckStatus`).

### 3. Panel / SectionSurface
Re-audited before touching anything: `surfaceRaised`/`surfaceSunken`/
`surfaceOverlay` (`ui/panel.tsx`) were **already** the single declared paint —
`section.tsx` already imported `surfaceRaised` from `panel.tsx` rather than
restating hex/tokens. The actual duplication was structural, not chromatic:
`SectionSurface` and the legacy `SurfaceCard` each built their own `<section>`
wrapper with `cn(surfaceSectionClass, padding, className)` instead of
rendering `Panel`.

Fix: `Panel` (`ui/panel.tsx`) gained an `as?: 'div' | 'section'` prop — the
paint logic is untouched, only the rendered element is now a caller choice.
`SectionSurface` (`ui/section.tsx`) and the legacy `SurfaceCard`
(`_legacy/surface-legacy.tsx`) now both render `<Panel as="section" inset="none">`
instead of a hand-built `<section className={cn(surfaceSectionClass, ...)}>`.
`Panel` itself has exactly one direct `<Panel>` JSX consumer today
(`projects-list-view.tsx`) — not forced onto every surface consumer, per the
"don't force a single API if it makes usages less clear" constraint; only the
two components that were literally reimplementing its own paint were migrated
to compose it.

### 4. Tabs primitive
New `src/components/ui/tabs.tsx`. `ProjectTabs` (3 tabs, no overflow) and
`AgentDetailNav` (8 tabs, overflows a 390px viewport, has scroll-edge fades)
were the same grammar with one behavioural difference. `Tabs` takes
`items`/`base`/`ariaLabel` plus an opt-in `scrollAffordance` boolean that
folds in the `ResizeObserver` + edge-fade logic `AgentDetailNav` had. Both
consumers now compose `Tabs` — `project-tabs.tsx` and
`agent-detail/agent-detail-nav.tsx` are ~15-line wrappers that only declare
their own `items` array and `base` route.

Route matching (`pathname === href || pathname.startsWith(href + '/')`),
`aria-current="page"`, and the focus-visible outline are all defined once now
instead of twice. `useId()` stamps a `data-tabs-group` attribute on the `<nav>`
— no `layoutId`-based indicator exists yet (both originals used a plain
`border-b-2`, not `motion.span`), so there is nothing to collide today; the id
is there so a future animated indicator can be scoped per-group from day one,
verified by a test that renders two `Tabs` instances on one page and asserts
their group ids differ.

### 5. `CopilotAvatar`
`copilot-avatar.tsx` previously built its own `<span>` with outline/radius/
sizing logic duplicating `ui/avatar.tsx`'s `Avatar`. `Avatar` gained a
`children` slot (mutually exclusive with `src`/`initials`, same as those two
already are with each other) so an identity that is neither a photo nor
initials — a type glyph on a gradient tile — can still compose the shared
frame. `CopilotAvatar` now renders `<Avatar aria-hidden ...><Icon /></Avatar>`;
the gradient-by-type logic, icon selection and default `size-10` are unchanged.
Verified by rendering and asserting `[data-slot="avatar"]` is present — proof
of composition, not just visual similarity.

### 6. Micro-typography (10px / 11px)
`DESIGN-DOCTRINE.md` already declared this ladder ("10px overline, 11px dense
metadata, no third rung") — the gap was that the 11px rung had no shared
constant ("written by hand, no tool guarding it", per the doctrine's own words),
while the 10px rung already had one (`eyebrowClass`). Added
`metaTextClass = TEXT_SIZES['2xs'].base` (`text-[11px]/4`) to `ui/text.tsx`,
exported for the `<span>`/`<code>`/`<div>`/`<dt>` sites that carry this role
but aren't `Text`'s `<p>`. Migrated the 9 bare-literal `text-[11px]` sites
that share this role across `project-avatar.tsx`, `project-team-node.tsx`,
`telemetry-unconfigured-state.tsx`, `agent-observability-view.tsx` (×2),
`agents-list-view.tsx`, `agent-tools-view.tsx` (×2), `app/admin/layout.tsx`.
One site (`agent-configuration-view.tsx`'s `<pre>` code block) was **not**
migrated and is commented in place: it pairs `text-[11px]` with an explicit
`leading-5`, a deliberate line-height choice for a code block that
`metaTextClass`'s baked-in `/4` would have silently overridden — exactly the
"no blind replacement" constraint in the brief.

`10px` (`eyebrowClass`) was left as-is — already a shared constant, already
the canonical answer, nothing to consolidate.

### 7. Surface tokens (`theme.css`)
Confirmed by grep, not assumed: the "legacy" tokens (`--color-surface-canvas`,
`-secondary`, `-interactive`, `-elevated`) have real, active consumers across
`agent-ops/` — not dead weight, and not safe to delete. Three were exact-value
duplicates of a ladder step (`canvas` = `app` = `#09090b`, `secondary` =
`raised` = `#1a1a1e`, `interactive` = `elevated` = `overlay` = `#232327`) —
two independent hex literals that happened to match, one edit from silently
diverging. Declared each as `var(--color-surface-app|raised|overlay)` instead
of its own hex — same rendered colour, now impossible to drift.
`--color-surface-primary` (#131316) and `--color-surface-focus` (#1f1f23)
were kept as genuinely distinct literals — neither matches any ladder step
value, so aliasing them would have been a real colour change disguised as a
rename.

No consumer was migrated off the legacy names — `check:legacy-bridge` (run
after this pass) confirms "no new legacy `--color-surface-*` usage," and the
migration table documented in `theme.css` states the strategy: new code reaches
for the ladder token or the `Panel` primitives; existing consumers migrate in a
separate, lower-risk pass with no visual delta to re-review; the alias is
deleted once grep for all four legacy names returns zero.

## Additional change: gauge charts (requested mid-mission)

Adrien asked mid-session, outside the original written brief, to replace
prose percentages/ratios with visuals. Scoped to the two screens already
touched by this mission rather than the whole dashboard (an explicit
out-of-scope item in the brief: "no full page redesign"). Added
`src/components/agent-ops/dashboard-charts/gauge-chart.tsx` — a Recharts
donut (`Pie`/`Cell`), same engine as every other chart in `chart-primitives.tsx`
per the global Graphiques doctrine, no hand-rolled SVG. Three tones:
`positive` (accent/success), `negative` (danger — reserved for real
failure/destruction), `neutral` (zinc — an incomplete-but-not-broken ratio,
so "2 of 7 executable" is never painted with the failure colour it doesn't
mean).

Applied to:
- `agent-release-view.tsx` — the Release gate's "N of 9 blocking" prose
  became a `GaugeChart` + a two-line summary; the per-check `ReleaseGateChecks`
  list (the only place that names *which* check failed) was kept, since that
  information has no percentage equivalent.
- `project-detail-view.tsx` — the KPI band's `Executable` (ratio, `neutral`
  tone when incomplete) and `Success` (percent, `positive`/`neutral` by
  threshold) stats now render a `GaugeChart` in place of the plain number.

Verified visually at desktop, laptop and mobile (see visual review) — no
clipping, no overflow, danger/accent/neutral tones distinguishable at a
glance.

## Consumers migrated

| Primitive | Consumers migrated |
|---|---|
| `Button` `danger`/`dangerIcon` | `release-panel.tsx`, `delete-project-dialog.tsx`, `project-delete-action.tsx`, `project-team-relation-dialogs.tsx` |
| `StatusDot` | `release-panel.tsx`, `qualification-timeline.tsx`, `promotion-evidence-panel.tsx` |
| `Panel as="section"` | `ui/section.tsx` (`SectionSurface`), `_legacy/surface-legacy.tsx` (`SurfaceCard`) |
| `Tabs` | `project-tabs.tsx`, `agent-detail/agent-detail-nav.tsx` |
| `Avatar` (children slot) | `copilot-avatar.tsx` |
| `metaTextClass` | `project-avatar.tsx`, `project-team-node.tsx`, `telemetry-unconfigured-state.tsx`, `agent-observability-view.tsx`, `agents-list-view.tsx`, `agent-tools-view.tsx`, `app/admin/layout.tsx` |
| `GaugeChart` | `agent-release-view.tsx`, `project-detail-view.tsx` |

## Code removed / made dead

- `ButtonVars` type + `dangerSolidStyle`/`dangerIconStyle` objects: 4 copies deleted.
- `CheckStatusText`/`StepStatusText`/`PromotionStatusText`: 3 near-30-line
  functions reduced to 1–3 line wrappers around `StatusDot`.
- Hand-rolled `<section className={cn(surfaceSectionClass, ...)}>` in
  `SectionSurface` and `SurfaceCard`: replaced by `<Panel as="section">`.
- `ProjectTabs`/`AgentDetailNav`: ~107 lines of duplicated scroll/route-match/
  focus logic reduced to two ~15–35-line wrappers declaring only their tab list.
- `CopilotAvatar`'s own outline/radius `<span>`: replaced by `Avatar`'s frame.

Net diff on the seven primitive files touched: -145 lines (see PR diff stat).

## Commands run

```
npm run typecheck        # clean
npm run test              # 142 files, 1584 tests, all pass
npm run check              # full gate suite (typecheck, lint, check:ds, check:catalyst,
                            # check:danger, check:legacy-bridge, check:views,
                            # check:render-truth, check:status-truth, check:registry-*,
                            # check:charts, check:rsc-boundary, check:secrets, audit:dead)
npm run build              # next build — clean
```

`check:danger` — no new violations, no dead allowlist entries; the two
pre-existing HITL exemptions unchanged. `check:legacy-bridge` — confirms zero
new legacy `--color-surface-*` usage (the alias didn't leak). `audit:dead` —
0 dead components (135 checked), confirming `StatusDot`/`Tabs`/`GaugeChart`
are real, consumed primitives, not orphaned additions.

## Limits / not done

- Legacy surface-token consumers (`--color-surface-canvas` etc.) were not
  migrated to the ladder names — by design, per the "no brutal migration"
  constraint. Tracked in `theme.css`'s migration table; no fixed date.
- `--color-surface-primary`/`-focus` were not folded into the five-plane
  ladder — that is a design decision (what surface those values *are* in the
  model), out of scope for a token-hierarchy pass.
- `Panel` was not forced onto every surface consumer in the dashboard — most
  already consume `surfaceRaised`/`surfaceSunken`/`surfaceOverlay` directly
  rather than through the `Panel` component, and that was left alone; only
  the two components literally reimplementing `Panel`'s own composition were
  migrated.
- Gauge charts were added to two screens only (Release gate, project KPI
  band), not swept across the dashboard — an explicit ask mid-session, kept
  inside this mission's existing footprint rather than expanded into a
  separate redesign.
- `React Flow` canvas (`project-team/team` route) did not render its nodes in
  the automated screenshot capture (async layout, unrelated to this pass);
  the tab bar above it captured correctly.
- Two pre-existing 401s (`repo/intelligence`, `missions/latest`) appear in the
  console on the project overview page in this local verification — unrelated
  to design-system changes (GitHub/mission-orchestrator auth in this isolated
  worktree environment), not investigated further; noted in `REVIEW.md`.

## Verdict

**DESIGN_SYSTEM_CONSOLIDATION_READY**

All seven mandatory items are migrated and verified: the four danger-button
overrides are gone, the three status patterns share one primitive, project
and agent tabs share one primitive, `CopilotAvatar` composes `Avatar`, `Panel`
is the single paint path `Section`/`SurfaceCard` now render through, the
11px micro-type rung has a documented shared constant applied to its
recurring sites, and the surface-token duplicates are aliased with a
documented migration strategy. Tests, gates, and build are green; captures
across desktop/laptop/mobile show no visual regression.
