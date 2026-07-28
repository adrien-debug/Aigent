# AIGENT-FRONTEND-RESET-001 — Figma reference notes

## Frames actually consulted

Source: <https://www.figma.com/design/PcRojj40scnVrRzZSon5G6/Vision---Marketing-Dashboard-UI-KIT-2?node-id=0-1&m=dev&t=Z5qHRikFDp2EO1PA-1>

Consulted in a driven Chromium on 29/07/2026, under an existing Figma session
(the file opened read-only; the toolbar showed the "Inscrivez-vous pour
commenter, modifier, **inspecter**" banner).

| Frame | How it was read | What it contributed |
| --- | --- | --- |
| Canvas overview (zoom "ajusté", 4 %) | full-page screenshot | The kit's inventory: Login / Dashboard / Notifications / Analytics / Sales / Product / Create / Customer / Withdraw / Profile / Inbox / Settings, each in Light and Dark, plus a mobile tier. |
| `Dashboard Dark_Dark` at 50 % | full-page screenshot | The composition actually reused: left rail with identity on top, grouped nav, active item as a filled pill; topbar with a long search field, a date block, a bell and an avatar; a 2/3 hero surface beside a 1/3 ring; a 2/3 dense table beside a 1/3 list. |
| `Dashboard Dark_Dark` at 100 % | full-page screenshot | Row density, label/value hierarchy inside the KPI tiles, badge shape (full-radius pill), the ring's proportions. |

### Limitation, stated rather than worked around

**Dev-mode inspection was NOT available** on this session: the file opened
without an editor seat, so no panel exposed numeric spacing, radii or colour
values. Everything below was read off rendered pixels, not off Figma's inspector.
That is the reason the "pixel-perfect" clause of P003 is reported as PARTIAL in
`REVIEW.md` rather than claimed as met.

## Colour mapping — Figma → Catalyst tokens

P003 requires Catalyst with no parallel design system, and forbids disabling any
gate. `npm run check:ds` allows exactly one chromatic family (the accent ramp in
`src/theme.css`) plus zinc, and it rejected the Vision hues outright when they
were tried (measured: `bg-emerald-4`, `text-amber-3`, `ring-red-4` all flagged).
The frame's colours are therefore MAPPED onto the sanctioned roles rather than
copied. This table is that mapping — it is a deliberate substitution, not an
approximation of an unreachable value.

| Vision frame (sampled) | Role in the frame | Aigent / Catalyst token | Rendered value |
| --- | --- | --- | --- |
| near-black page ground | page background | `--surface-app` (via `SidebarLayout`) | theme-defined |
| dark graphite card | raised surface | `surfaceRaised` / `<Panel>` | theme-defined |
| darker inset | recessed tile | `surfaceSunken` / `<Panel tone="sunken">` | theme-defined |
| mint green | positive / success | accent ramp — `<Badge color="accent">`, `text-accent-300`, ring stroke `text-accent-500` | `#a7fb90` family |
| red | failure | `--state-danger-*` — `<Badge color="danger">`, `text-[var(--state-danger-text)]` | `#e5484d` / `#f87171` |
| amber | blocked / pending | **no amber role exists**; blocked joins `danger`, pending uses `zinc` | — |
| white | primary text | `text-white` / `<Heading>` / `<Text tone="strong">` | — |
| mid grey | metadata | `text-zinc-400` / `<Text tone="muted">` | — |
| white pill, active nav | active navigation item | `<SidebarItem current>` | kit-defined |

The amber row is the one place where a frame distinction is deliberately lost:
`theme.css` documents `--state-danger-*` as "the only deliberate exception" to
the mono-accent rule, so introducing a third hue would have required either a
new token or a disabled gate — both forbidden by P003. `blocked` keeps its own
LABEL, which is what carries the meaning.

## Structure taken from the frame

| Aspect | Frame | Implementation |
| --- | --- | --- |
| Shell | fixed left rail + content column | `SidebarLayout` (Catalyst) — same shape, kit-owned spacing |
| Rail contents | identity, one grouped nav, footnote | `Sidebar` + `SidebarSection` + `SidebarHeading` + `SidebarFooter` |
| Topbar | long search, date, bell, avatar | `InputGroup`+`Input`, `<time>`, notifications menu, `Avatar` |
| Row 1 | 2/3 summary + 1/3 ring | `lg:grid-cols-3` with `lg:col-span-2` |
| Row 2 | 2/3 table + 1/3 side list | `min-[1700px]:grid-cols-3` — see the deviation note below |
| Table | dense rows, pill badges | `<Table dense>` + `<Badge>` |

### Documented deviation — the 2/3 feed threshold

The frame puts the table at 2/3 on a tablet-sized canvas. Here the eight
mission-required columns need ~855 px with Catalyst's cell padding; a 2/3 slice
of a 1440 px viewport gives ~722 px, which pushed Cost, Started and Trace behind
a horizontal scrollbar (measured). The split therefore engages at 1700 px, and
below that the feed takes the full width with the activity panel beneath it.
Keeping every required column on screen outranks holding the ratio at every size.
