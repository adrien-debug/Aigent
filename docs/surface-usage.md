# Surface usage — Aigent admin dashboard

Rules for visual hierarchy on `/admin/**` surfaces. UI-only contract; no new color tokens.

## Three levels (+ navigation)

```
Canvas (#000)          ← page background, headers, naked KPI strips
└── Section (#121214)  ← functional panels (Projects, tables, workbench)
    └── Item (#1f1f22) ← business objects (project row, agent card, KV tile)

Navigation (#09090b)   ← sidebar rail; lighter border, must not compete with sections
```

Import from `@/components/agent-ops/surface-card`:

| Export | Level | When to use |
|--------|-------|-------------|
| `AdminPageHeader` | Canvas | **Canon** page title — Catalyst `Heading` (`text-2xl/8` = 24px). The only page header. |
| `surfaceSectionClass` / `SurfaceCard` | Section | Data panels, tables, workbench shells |
| `SurfaceCardHeader` | Section title | H2 via `Subheading` (`text-base/7 sm:text-sm/6`, `tone="neutral"`) |
| `surfaceItemClass` | Item | Rows, cards, selectable tiles inside a section |
| `surfaceNavClass` | Nav | Sidebar only |
| `surfaceInsetClass` | Inset | Subtle grouping inside a section (not a full card) |

### Typography canon (admin)

| Role | Component | Size |
|------|-----------|------|
| H1 | `Heading` | `text-2xl/8` (24px) — never `text-3xl` |
| H2 section | `Subheading` + `tone="neutral"` | `text-base/7` → `sm:text-sm/6` |
| Body | `Text` | `text-base/6` → `sm:text-sm/6` |
| Eyebrow / KPI label | — | `text-[10px] uppercase tracking-widest` |
| KPI value | mono | ≤ H1 (`text-2xl/8` max) |

`surfaceCardClass` is an alias for `surfaceSectionClass` (backward compatible).

## Composition checklist

Every admin page must answer:

1. **Canvas** — black background; page header and KPI strip live here.
2. **Section** — at most one `surface-secondary` shell per functional block.
3. **Items** — business objects use `surface-elevated`, not another section shell.

### Forbidden patterns

- Section inside section inside section (`secondary` × 3).
- Page header wrapped in `SurfaceCard` (use `AdminPageHeader`).
- KPI band inside a section card (use naked `AgentKpiBand` on canvas).
- Empty state as a full `SurfaceCard` (use dashed border on canvas).
- Sidebar using `surfaceSectionClass` (use `surfaceNavClass`).
- Peer panels on the canvas painted as Item (`AgentBentoCard` must use Section —
  Item is only for rows/tiles *inside* a section).

### Allowed exceptions

- Selectable items may use `ring` for focus/selection affordance.
- Progress meters and chart tracks are not “cards”.
- `ProjectHeader` is a section-level identity block on the canvas (one section for the project hero).

## Section headers

`surfaceSectionHeaderClass` = hairline bottom border only. No `bg-black/20` wash.

Table `<thead>` rows: `border-b border-white/5` — no background fill.

## Tokens (existing — do not add)

- `--color-surface-canvas` — `#000000`
- `--color-surface-primary` — `#09090b` (nav)
- `--color-surface-secondary` — `#121214` (sections)
- `--color-surface-elevated` — `#1f1f22` (items)
- `--color-surface-focus` — `#27272a` (hover/focus on items)
- `accent-*` — single chromatic hue

## Routes audited (AIG-DS-SURFACE-001)

- `/admin` — header + KPI on canvas; Projects / Requires Attention as sections
- `/admin/performance` — flattened header + KPI
- `/admin/telemetry` — flattened header + KPI
- `/admin/settings` — canvas header; KV tiles as items inside sections
- `/admin/projects/[id]` — project header section; tables as sections
- `/admin/agents/new` — canvas header
- Agent tabs (benchmarks, replay) — nested cards flattened to items / dashed empties
