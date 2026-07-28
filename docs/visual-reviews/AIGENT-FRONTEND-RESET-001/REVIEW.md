# AIGENT-FRONTEND-RESET-001-P001 — visual review

Route: `/admin-v2/runs` · Branch: `feat/aigent-frontend-reset-001` · Captured 29/07/2026 against
the local dev server on port 3210 with live gpu1 data (6 real operational runs).

## What the screenshots show

| File | Viewport | State |
| --- | --- | --- |
| `desktop-1440x900.png` | 1440×900 | Populated. Rail, topbar, 2/3 summary + 1/3 ring, full-width feed with all eight required columns. |
| `laptop-1280x800.png` | 1280×800 | Populated. |
| `tablet-1024x768.png` | 1024×768 | Populated, rail still visible. |
| `mobile-375x812.png` | 375×812 | Stacked cards, burger header. |
| `mobile-nav-open-375x812.png` | 375×812 | Navigation drawer open. |
| `empty-filtered-1440x900.png` | 1440×900 | Filters exclude everything: KPIs recompute to 0, cost and rate read "Not measured", activity panel says so too. |
| `error-state-1440x900.png` | 1440×900 | **Real** backend outage (`AMC_SUPABASE_URL=http://127.0.0.1:9`), HTTP **500**, not a synthetic throw. |

## Fidelity to the Vision frame — honest breakdown

### Faithful to the frame
- Shell shape: fixed left rail + content column; identity at the top of the rail; grouped nav; active entry as a filled pill.
- Topbar: long search field, date/time block, notifications control, account avatar — in that order.
- Composition: 2/3 hero surface beside a 1/3 ring; dense table with pill status badges; a side list of entities.
- Dark-first, low-contrast surface separation, white primary text over muted grey metadata.

### Adapted to Aigent (deliberate, documented)
- **Colours are MAPPED, not copied** — see `reference-notes.md`. P003 requires Catalyst with no parallel design system and no disabled gate; `check:ds` allows only the accent ramp + zinc and rejected the Vision hues when tried. Mint → accent, red → `--state-danger-*`, amber → folded into danger/zinc.
- **No amber role exists**, so `blocked` shares the danger colour and keeps its own label.
- **Feed 2/3 split engages at 1700px**, not at every size: the eight required columns need ~855px and a 2/3 slice of 1440px gives ~722px, which hid Cost/Started/Trace behind a scrollbar (measured).
- The marketing sphere and all demo content are absent by instruction.

### Not implemented
- Per-frame numeric verification (spacing ±2px, radii ±1px) and a side-by-side/overlay diff at the four viewports. **Not done** — see below.

## Known limitations

1. **Pixel-perfect verification: NOT performed.** Figma dev-mode inspection was unavailable on this session (read-only file, no editor seat), so no numeric spacing/radius/colour values could be read from the source. Measuring "±2px on structural spacing, ±1px on radii" against pixels estimated from a screenshot would be a number I could not defend, so it is reported as missing rather than asserted. Spacing and radii currently come from the Catalyst scale, which P003 mandates.
2. **Overlay comparison: NOT produced**, for the same reason — an overlay against a rescaled screenshot would measure my own rescaling as much as the design.
3. `mobile-nav-open` is Catalyst's `SidebarLayout` drawer, not a bespoke sheet.
4. The dev-tools badge visible bottom-left in some shots is Next.js' development indicator; it does not exist in a production build.

## Gates

`npm run check` exits **0** with every historical gate now also scanning the V2 perimeter
(`check:ds`, `check:catalyst`, `check:tables`, `check:danger`, `check:render-truth`,
`check:status-truth`, `check:charts`, `check:class-collision`). No gate was disabled or
weakened; `scripts/check-frontend-v2-boundary.mjs` was REPURPOSED (it used to forbid Catalyst
in V2; it now forbids a parallel design system) rather than removed.
