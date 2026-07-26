#!/usr/bin/env node
/**
 * Design-system guard — fails CI if the monochrome contract is broken.
 *
 * 1) No chromatic hue other than `accent` / `zinc` anywhere in `src` (the
 *    Catalyst-derived primitives in `ui/` keep their full palette, so they
 *    are excluded).
 * 2) The accent ramp DECLARED IN src/theme.css is complete, anchored on the
 *    brand green, and monotonic.
 * 3) The solid accent surfaces keep WCAG AA (≥ 4.5:1) for their text.
 *
 * Pure Node, no deps. Run via `npm run check:ds`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
// The ramp lives HERE. src/app/globals.css is a one-line stub that
// `@import "../theme.css"` — an earlier version of this guard named it as the
// source and hard-coded the hexes, so the ramp could be repainted in theme.css
// without moving a single number in this file. The gate now reads the ramp.
const THEME_CSS = join(SRC, 'theme.css')
const EXCLUDE_DIR = join('components', 'ui') // the primitive owns the full palette

const HUES = [
  'red', 'orange', 'amber', 'yellow', 'lime', 'green', 'emerald', 'teal',
  'cyan', 'sky', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose',
  // `zinc` is the ONLY sanctioned neutral — its Tailwind rivals are contraband too.
  'slate', 'gray', 'neutral', 'stone',
]
const PREFIX = 'bg|text|ring-offset|ring|border|fill|stroke|from|to|via|decoration|outline|divide|shadow|caret|placeholder'
const CLASS_RE = new RegExp(`\\b(${PREFIX})-(${HUES.join('|')})-[0-9]`, 'g')
const PROP_RE = new RegExp(`(?:color|badgeColor)\\s*[:=]\\s*['"](${HUES.join('|')})['"]`, 'g')
const VAR_RE = new RegExp(`--color-(${HUES.join('|')})-[0-9]`, 'g')

// The doctrine bans hand-written accent opacities (`bg-accent-500/30`, `ring-accent-400/80`…):
// if the need is one of the four named roles, consume the token. Scoped to the dashboard —
// marketing keeps its own restyled blocks. Matches a numeric accent shade WITH a slash opacity;
// `bg-[var(--accent-soft)]`, `text-accent-400`, `ring-(--accent-line)` are all clean.
const ACCENT_OPACITY_RE = new RegExp(`\\b(${PREFIX})-accent-[0-9]{2,3}/[0-9]`, 'g')
const DASHBOARD_DIRS = [join('app', 'admin'), join('components', 'agent-ops')]

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      yield* walk(full)
    } else if (/\.(ts|tsx|css)$/.test(entry.name)) {
      // `.css` included so globals.css — the ONE file declaring `--color-*` —
      // is actually scanned; VAR_RE was dead code while walk() skipped it.
      yield full
    }
  }
}

// --- the accent ramp, READ from src/theme.css --------------------------------
// The brand green #a7fb90 anchors 500 (Catalyst fills its primary button with
// it); 600 is the darker vivid step (Badge `accentSolid`); 700 the dark solid
// end. Solid accent surfaces carry DARK text (text-zinc-950), so those are the
// pairs that must clear AA.
const ZINC_950 = '#09090b'
// Every step theme.css promises. A missing key is a hole in the ramp: Tailwind
// silently drops `bg-accent-300` and the class renders as nothing.
const REQUIRED_SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
// The one number the doctrine pins by value (AGENTS.md, CLAUDE.md): shade 500
// IS Adrien's green. Everything else may be retuned; this may not drift.
const BRAND_ACCENT_500 = '#a7fb90'
const ACCENT_DECL_RE = /--color-accent-(\d{2,3})\s*:\s*(#[0-9a-fA-F]{3,6})\s*;/g

/** Expand `#abc` → `#aabbcc` and lowercase, so comparisons are on one form. */
function normalizeHex(hex) {
  const raw = hex.slice(1).toLowerCase()
  if (raw.length === 3) return '#' + raw.split('').map((c) => c + c).join('')
  return '#' + raw
}

function parseAccentRamp(css) {
  const ramp = new Map()
  ACCENT_DECL_RE.lastIndex = 0
  let m
  while ((m = ACCENT_DECL_RE.exec(css))) {
    ramp.set(Number(m[1]), normalizeHex(m[2]))
  }
  return ramp
}

function lin(c) {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}
function luminance(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

// Live-only: nothing in the running app may import the seed fixtures. seed-fixtures.ts
// stays (used by scripts/seed-amc.ts to seed the real DB) but the app is severed.
const MOCK_IMPORT_RE = /from\s+['"](?:@\/lib\/agent-mission-control\/seed-fixtures|\.{1,2}(?:\/[^'"]*)?\/seed-fixtures|\.\/seed-fixtures)['"]/
const mockImports = []

async function main() {
  const ramp = parseAccentRamp(await readFile(THEME_CSS, 'utf8'))

  // A ramp that lost a step, or that stopped being the brand green, is a
  // design-system break the class scan below cannot see — every `accent-*`
  // class stays spelled correctly while rendering the wrong thing (or nothing).
  const missingShades = REQUIRED_SHADES.filter((shade) => !ramp.has(shade))
  const anchorFails = []
  if (ramp.has(500) && ramp.get(500) !== BRAND_ACCENT_500) {
    anchorFails.push(
      `--color-accent-500 is ${ramp.get(500)}, not the brand green ${BRAND_ACCENT_500}` +
        ` (contrast with zinc-950: ${contrast(ZINC_950, ramp.get(500)).toFixed(2)}:1)`
    )
  }
  // theme.css promises "every step is a DISTINCT luminance" so intensity-encoded
  // ladders read as steps. Enforce it: strictly decreasing 50 → 950. A ramp that
  // folds back on itself makes a "darker" shade lighter than the one before it.
  const rampOrderFails = []
  const declared = REQUIRED_SHADES.filter((shade) => ramp.has(shade))
  for (let i = 1; i < declared.length; i += 1) {
    const [prev, cur] = [declared[i - 1], declared[i]]
    const [lp, lc] = [luminance(ramp.get(prev)), luminance(ramp.get(cur))]
    if (lc >= lp) {
      rampOrderFails.push(
        `accent-${cur} (${ramp.get(cur)}, L=${lc.toFixed(4)}) is not darker than accent-${prev} (${ramp.get(prev)}, L=${lp.toFixed(4)})`
      )
    }
  }

  const violations = []
  const accentOpacityViolations = []
  for await (const file of walk(SRC)) {
    const rel = relative(SRC, file)
    if (rel.includes(EXCLUDE_DIR)) continue
    const isDashboard = DASHBOARD_DIRS.some((d) => rel.startsWith(d + '/') || rel === d)
    const text = await readFile(file, 'utf8')
    if (rel !== 'lib/agent-mission-control/seed-fixtures.ts' && MOCK_IMPORT_RE.test(text)) {
      mockImports.push(relative(ROOT, file))
    }
    text.split('\n').forEach((line, i) => {
      for (const re of [CLASS_RE, PROP_RE, VAR_RE]) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) {
          violations.push(`${relative(ROOT, file)}:${i + 1}  ${m[0]}`)
        }
      }
      // Hand-written accent opacity — dashboard only (marketing keeps its blocks).
      if (isDashboard) {
        ACCENT_OPACITY_RE.lastIndex = 0
        let a
        while ((a = ACCENT_OPACITY_RE.exec(line))) {
          accentOpacityViolations.push(`${relative(ROOT, file)}:${i + 1}  ${a[0]}`)
        }
      }
    })
  }

  const AA = 4.5
  // Ratios computed from the ramp actually declared in theme.css — repaint a
  // shade there and the number printed here moves with it.
  const contrastChecks = [
    ['zinc-950 on accent-500 (Catalyst primary button)', ZINC_950, 500],
    ['zinc-950 on accent-600 (Badge accentSolid)', ZINC_950, 600],
    ['white on accent-700 (dark solid end)', '#ffffff', 700],
  ]
    .filter(([, , shade]) => ramp.has(shade))
    .map(([name, fg, shade]) => [name, contrast(fg, ramp.get(shade))])
  const contrastFails = contrastChecks.filter(([, ratio]) => ratio < AA)

  let failed = false
  if (missingShades.length > 0) {
    failed = true
    console.error(`\n✗ ${missingShades.length} accent shade(s) missing from src/theme.css:\n`)
    for (const shade of missingShades) console.error(`  --color-accent-${shade}`)
  }
  if (anchorFails.length > 0) {
    failed = true
    console.error('\n✗ accent anchor drifted in src/theme.css:\n')
    for (const v of anchorFails) console.error('  ' + v)
  }
  if (rampOrderFails.length > 0) {
    failed = true
    console.error('\n✗ accent ramp is not a monotonic luminance ladder (src/theme.css):\n')
    for (const v of rampOrderFails) console.error('  ' + v)
  }
  if (violations.length > 0) {
    failed = true
    console.error(`\n✗ ${violations.length} non-accent hue(s) in src (only accent/zinc allowed):\n`)
    for (const v of violations) console.error('  ' + v)
  }
  if (accentOpacityViolations.length > 0) {
    failed = true
    console.error(`\n✗ ${accentOpacityViolations.length} hand-written accent opacity(ies) in the dashboard (consume a named --accent-* role token):\n`)
    for (const v of accentOpacityViolations) console.error('  ' + v)
  }
  if (contrastFails.length > 0) {
    failed = true
    console.error('\n✗ WCAG AA contrast failures:\n')
    for (const [name, ratio] of contrastFails) console.error(`  ${name}: ${ratio.toFixed(2)}:1 (< ${AA})`)
  }
  if (mockImports.length > 0) {
    failed = true
    console.error('\n✗ mock dataset imported by the app (live-only — use the data layer):\n')
    for (const f of mockImports) console.error('  ' + f)
  }

  if (failed) {
    console.error('\nDesign-system guard FAILED.\n')
    process.exit(1)
  }
  console.log(
    `✓ Design-system guard passed — monochrome accent + zinc, ${ramp.size}-step accent ramp read from src/theme.css, contrasts AA, no mock in app.`
  )
  for (const [name, ratio] of contrastChecks) console.log(`  ${name}: ${ratio.toFixed(2)}:1`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
