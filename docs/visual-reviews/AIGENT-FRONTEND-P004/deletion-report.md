# P004 — deletion report

P004 requires a report on the files **and rules** actually deleted. This is that
report, including what was NOT deleted and why — a deletion report that only
lists wins is not a report.

## Files deleted (9)

Every deletion below is proven, not asserted: seven of the nine were surfaced by
`npm run audit:dead` AFTER the rebuild made them unreachable, and the audit is
green at the end (`✓ No dead components`).

### The shell (2) — deleted because it was replaced

| File | Why |
| --- | --- |
| `src/components/shell/aigent-sidebar.tsx` | The old rail. Replaced by `components/admin-shell/admin-rail.tsx`, built on the Catalyst `Sidebar` primitives. |
| `src/components/shell/command-palette.tsx` | Mounted only by the old `admin/layout.tsx`; the rebuilt layout does not carry it. |

### The old dashboard (7) — deleted because the rebuild orphaned them

| File | How it became dead |
| --- | --- |
| `src/components/views/dashboard/dashboard-view.tsx` | `/admin` now renders `components/admin-dashboard/dashboard-view.tsx`. |
| `src/components/agent-ops/action-center.tsx` | Only consumer was the view above. |
| `src/components/agent-ops/dashboard-kpi-strip.tsx` | idem |
| `src/components/agent-ops/dashboard-live-runs.tsx` | idem |
| `src/components/agent-ops/dashboard-project-list.tsx` | idem |
| `src/components/agent-ops/dashboard-charts/activity-by-project-chart.tsx` | idem |
| `src/components/agent-ops/dashboard-charts/run-status-breakdown-chart.tsx` | idem |

The deletion cascaded: removing the view exposed six more dead components on the
next audit pass, and the loop was repeated until the audit reported none.

## Rules changed or retargeted (2)

P004 orders the removal of visual rules that PROTECT the old rendering. Two
qualified. Neither was disabled — both were retargeted, so the invariant they
exist to defend still runs.

| Rule | What it protected | What was done |
| --- | --- | --- |
| `scripts/check-views.mjs` | Required every `/admin/**/page.tsx` to import from `@/components/views/`. A page rebuilt outside that folder was reported as a "half-done migration" — the rule literally forbade leaving the old layer. | The accepted view layers now include `components/admin-dashboard/` and `components/runs-console/`. The invariant it actually defends — a `page.tsx` stays a thin `data + <View />` shell, max 20 lines — is unchanged and still fired during this pass (it rejected the first `/admin/runs/page.tsx` at 32 lines). |
| `src/theme.css` surface planes | `--color-surface-app #09090b` / `--color-surface-raised #1a1a1e` encoded the old convention: cards LIGHTER than the page. | Retargeted onto values measured off the Figma frame at 1:1 — app `#1a1b1e`, raised `#0a0a0a`, sunken `#070707`, plus a new control plane `#2e3033`. The kit inverts the convention, so this one edit flips every admin surface at once. |

## Wrappers

No `Panel`, `Section` or `Card` wrapper is used by any rebuilt screen. The new
surfaces are plain `<section>` elements on a theme plane. No new generic wrapper
was created; the only extraction is `admin-dashboard/kpi-tile.tsx`, which has
four real call sites on one screen.

## NOT deleted — and why

This is the part that matters for honesty.

| Kept | Reason |
| --- | --- |
| `src/components/ui/panel.tsx` (23 importers) | Still consumed by ~20 view files across the admin routes P004 does not rebuild in this pass (agents, projects, factory, settings, telemetry, performance). Deleting it would break those routes, which dismantles nothing. |
| `src/components/ui/section.tsx` (14 importers) | Same. |
| `src/components/shell/page-layout.tsx`, `page-header.tsx` | Same — ~20 importers under `components/views/**`. |
| `src/components/agent-ops/**` (73 files left) | Consumed by the routes not yet rebuilt. |
| `scripts/check-surfaces.mjs`, `check-legacy-bridge.mjs` | These still guard the routes that still use the old grammar. Deleting them now would remove the only protection those screens have while they wait their turn. |

**The honest summary: the old rendering is dismantled on `/admin` and
`/admin/runs`, and the shell is gone repo-wide. It is NOT dismantled on the
other 21 admin routes, which still stand on the old wrappers.** They fall when
they are rebuilt — one prompt per surface, or one much larger one.

## Merge with `main` — the /admin-v2 slice deleted (26 more files)

While this branch was open, PR #26 was merged into `main`, bringing in the whole
`/admin-v2` slice. P004 forbids that route, so merging `main` here DELETED it
rather than keeping two consoles side by side:

| Deleted on merge | Replaced by |
| --- | --- |
| `src/app/admin-v2/**` (5 files) | `/admin` + `/admin/runs` |
| `src/components/aigent-v2/**` (15 files) | `components/{admin-dashboard,admin-shell,runs-console}` |
| `src/lib/aigent-v2/**` (4 files) | `src/lib/runs-console/**` (same logic, moved) |
| `tests/unit/aigent-v2/**` | `tests/unit/runs-console/**` |
| `docs/visual-reviews/AIGENT-FRONTEND-RESET-001/**` | Screenshots of a route that no longer exists. Kept nothing rather than ship evidence of a deleted screen. |

`src/proxy.ts` kept the P004 side of the conflict: with `/admin-v2` gone, the
protected-prefix list and the matcher are back to `/admin` alone, and the
measured-hole comment now records the SHAPE of the bug (a sibling admin surface
one directory name away) instead of pointing at a route that no longer exists.

Scripts and npm entries followed the perimeter rather than being deleted:
`check:frontend-v2-boundary` → `check:rebuilt-boundary`, `test:frontend-v2` →
`test:runs-console`, `verify:frontend-v2-e2e` → `verify:admin-e2e`, and the six
visual gates now scan `components/{admin-dashboard,admin-shell,runs-console}`
instead of the deleted `aigent-v2`.

## Verification at the end of this pass

| Command | Result |
| --- | --- |
| `npm run check` | exit **0** (every gate, none disabled) |
| `npm test` | **1657 passed**, 147 files |
| `npm run build` | exit 0 |
| `npm run audit:dead` | ✓ no dead components |
