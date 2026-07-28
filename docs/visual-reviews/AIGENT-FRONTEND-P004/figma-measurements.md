# P004 — measurements taken FROM the Figma frame

Previous prompts reported pixel-perfect work as blocked because Figma dev-mode
inspection is unavailable on this session (read-only file, no editor seat).
That conclusion was too quick: **at 100 % zoom one canvas pixel is one frame
pixel**, so the values below are measured off the rendered frame itself, not
estimated from a rescaled thumbnail.

## Method (reproducible)

1. Open the file, zoom menu → **Zoom à 100 %** (the exact item; wheel notches
   jump 50 % ↔ 116 % and cannot land on 100).
2. Screenshot the viewport (`scale: device`, 1440×900 → 1 image px = 1 frame px).
3. Read pixels with PIL: sample colours at points, and detect edges by scanning
   a row/column for colour transitions above a tolerance.

Evidence: `figma-frame-100pct-analytics-dark.png` (frame `Analytics_Dark`, the
one the 100 % viewport landed on; it shares the kit's shell and card grammar
with `Dashboard_Dark`).

## Colours — sampled, not guessed

| Element | Sample point | Measured |
| --- | --- | --- |
| Page ground (frame background) | 700,500 | `#1A1B1E` |
| Control surface (search field, icon buttons) | 300,577 / 1009,560 | `#2E3033` |
| Date pill (filled) | 760,577 | `#FFFFFF` |
| Content card fill | 100,700 / 1100,700 | `#070707` → `#0A0A0A` (card carries a subtle vertical gradient) |

The kit is therefore **three planes**: a mid-charcoal ground `#1A1B1E`, controls
one step lighter `#2E3033`, and cards markedly DARKER than the ground
(`#070707`–`#0A0A0A`) — the inverse of the usual "cards lighter than page"
convention, and the single most characteristic trait of this design.

## Geometry — measured in pixels

| Quantity | How it was found | Measured |
| --- | --- | --- |
| Topbar control height (search field, bell) | column scan x=300 and x=1009, y 545→609 | **65 px** (⇒ 64 px + 1 px edge) |
| Control corner radius | corner profile of the date pill, inset per row | **≈ 16 px** |
| Gutter between topbar controls | bg run on row y=700, x 658→683 | **26 px** (⇒ 24 px + edges) |
| Topbar bottom → card top | y=609 → y≈678-681 | **≈ 70 px** |

## What is NOT measured yet

- `Dashboard_Dark` specifically (the 100 % viewport landed on `Analytics_Dark`);
  the shell and card grammar are shared, but the dashboard's own KPI/table
  spacings still need their own pass.
- Type sizes and line heights.
- The left card's left edge and outer page margin — the frame extends past the
  viewport at 100 %, so the measurement needs a pan first.

These gaps are listed rather than filled with plausible numbers.
