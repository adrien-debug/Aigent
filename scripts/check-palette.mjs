#!/usr/bin/env node
/**
 * Design-system guard — fails CI if the monochrome contract is broken.
 *
 * 1) No chromatic hue other than `accent` / `zinc` anywhere in `src` (the
 *    Catalyst primitive keeps its full palette, so it is excluded).
 * 2) The solid accent surfaces keep WCAG AA (≥ 4.5:1) for their white text.
 *
 * Pure Node, no deps. Run via `npm run check:ds`.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const EXCLUDE_DIR = join('components', 'catalyst') // the primitive owns the full palette

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

// --- WCAG contrast -----------------------------------------------------------
// Must mirror the real accent ramp in src/app/globals.css. The brand green #a7fb90
// anchors 500 (Catalyst fills its primary button with it); 600 is the darker vivid
// step (Badge `accentSolid`); 700 the dark solid end. Solid accent surfaces carry
// DARK text (text-zinc-950), so those are the pairs that must clear AA.
const ZINC_950 = '#09090b'
const ACCENT = {
  500: '#a7fb90',
  600: '#76ec55',
  700: '#2a7a20',
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
  const contrastChecks = [
    ['zinc-950 on accent-500 (Catalyst primary button)', contrast(ZINC_950, ACCENT[500])],
    ['zinc-950 on accent-600 (Badge accentSolid)', contrast(ZINC_950, ACCENT[600])],
    ['white on accent-700 (dark solid end)', contrast('#ffffff', ACCENT[700])],
  ]
  const contrastFails = contrastChecks.filter(([, ratio]) => ratio < AA)

  let failed = false
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
  console.log('✓ Design-system guard passed — monochrome accent + zinc, contrasts AA, no mock in app.')
  for (const [name, ratio] of contrastChecks) console.log(`  ${name}: ${ratio.toFixed(2)}:1`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
